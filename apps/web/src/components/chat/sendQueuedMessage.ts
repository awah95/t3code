import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommand,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { serializeLegacyContextMessage } from "@t3tools/shared/composerContextLegacySend";
import { applyClaudePromptEffortPrefix } from "@t3tools/shared/model";
import type { QueuedJevContext } from "../../jev/queuedRouting";
import { routeQueuedJevTurn } from "../../jev/queuedRouting";
import { useJevStore } from "../../jev/jevStore";
import { isElectron } from "../../env";

import { buildMessageContext, terminalContextReference } from "../../lib/composerContextRecords";
import { removeInlineContextReference } from "../../lib/composerContextReferences";
import {
  awaitAttachmentUploads,
  getUploadedAttachments,
  releaseDraftAttachments,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { newMessageId } from "../../lib/utils";
import { latestCompletedToolActivityId, useQueuedMessageStore } from "../../queuedMessageStore";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readThread, readThreadShell } from "../../state/entities";
import { environmentServerConfigsAtom } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import {
  createLocalDispatchSnapshot,
  deriveComposerSendState,
  readFileAsDataUrl,
  resolveThreadMetadataUpdateForNextTurn,
  revokeBlobPreviewUrl,
} from "../ChatView.logic";
import { toastManager } from "../ui/toast";
import { fileAttachmentCapabilityBlockReason } from "./composerAttachmentFiles";
import { ATTACHMENT_ONLY_BOOTSTRAP_PROMPT } from "./composerPromptHistory";

async function run<W, A, E>(command: AtomCommand<W, A, E>, input: W): Promise<A> {
  const result = await runAtomCommand(appAtomRegistry, command, input, { reportFailure: false });
  if (result._tag === "Failure") throw squashAtomCommandFailure(result);
  return result.value;
}

/**
 * Sends one queued message as a turn on its thread. `QueuedMessageSender`
 * calls it when the head message is due, and Send now calls it directly. It
 * reads nothing from the composer, so it works for threads that are not on
 * screen. A failed send stays at the head of the queue, held for Send now.
 */
export async function sendQueuedMessage(
  threadRef: ScopedThreadRef,
  messageId: string,
  jevContext?: QueuedJevContext,
  onReviewPending?: () => void,
): Promise<void> {
  const { environmentId, threadId } = threadRef;
  const threadKey = scopedThreadKey(threadRef);
  const queue = useQueuedMessageStore.getState();
  const message = queue.beginSend(
    threadKey,
    messageId,
    latestCompletedToolActivityId(readThread(threadRef)?.activities ?? []),
  );
  if (!message) return;
  const { sendSettings } = message;
  const attachments = [...message.images, ...message.files];
  const readConfig = () => appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId);
  const assertFilesAllowed = () => {
    const config = readConfig();
    const reason = fileAttachmentCapabilityBlockReason({
      files: message.files,
      attachmentUploadsCapabilityKnown: config !== undefined,
      supportsAttachmentUploads: config?.environment.capabilities.attachmentUploads === true,
      maxFileAttachmentBytes:
        config?.environment.capabilities.fileAttachments?.maxUploadBytes ?? null,
    });
    if (reason !== null) throw new Error(reason);
  };
  try {
    const { sendableTerminalContexts, hasSendableContent } = deriveComposerSendState({
      prompt: message.prompt,
      imageCount: attachments.length,
      terminalContexts: message.terminalContexts,
      elementContextCount: message.previewAnnotations.length + message.reviewComments.length,
    });
    // Only expired terminal context was left. Retrying would block the queue
    // on every boundary, so drop it and let the queue move on.
    if (!hasSendableContent) {
      queue.finishSend(threadKey, message.id);
      return;
    }
    // Expired terminal excerpts are not sent; their chips leave the text with them.
    const prompt = message.terminalContexts
      .filter((context) => !sendableTerminalContexts.includes(context))
      .reduce(
        (text, context) =>
          removeInlineContextReference(text, terminalContextReference(context).contextId).prompt,
        message.prompt,
      )
      .trim();
    const text = applyClaudePromptEffortPrefix(
      prompt || ATTACHMENT_ONLY_BOOTSTRAP_PROMPT,
      sendSettings.promptEffort,
    );

    assertFilesAllowed();
    const useUploads = readConfig()?.environment.capabilities.attachmentUploads === true;
    if (useUploads && attachments.length > 0) {
      for (const attachment of attachments) {
        startAttachmentUpload({ environmentId, image: attachment, draftTarget: threadRef });
      }
      await awaitAttachmentUploads(attachments.map((attachment) => attachment.id));
    }
    const wireAttachments = await Promise.all(
      attachments.map(async (attachment) => {
        if (useUploads) {
          const uploaded = getUploadedAttachments({ environmentId, images: [attachment] })?.[0];
          if (!uploaded) throw new Error(`Attachment '${attachment.name}' did not upload.`);
          return uploaded;
        }
        if (attachment.type !== "image") {
          throw new Error("This server does not support file attachments.");
        }
        return {
          type: "image" as const,
          id: attachment.id,
          name: attachment.name,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          dataUrl: await readFileAsDataUrl(attachment.file),
          ...(attachment.source ? { source: attachment.source } : {}),
        };
      }),
    );
    assertFilesAllowed();

    const thread = readThread(threadRef);
    const shell = readThreadShell(threadRef);
    const config = readConfig();
    const context = buildMessageContext({
      terminalContexts: sendableTerminalContexts,
      reviewComments: message.reviewComments,
      previewAnnotations: message.previewAnnotations,
      attachments: attachments.map((attachment, index) => ({
        attachment,
        attachmentId: wireAttachments[index]?.id ?? attachment.id,
      })),
    });
    const routingMode = useJevStore.getState().getThreadMode(environmentId, threadId);
    const routed = await routeQueuedJevTurn({
      threadRef,
      threadKey,
      message,
      text: prompt,
      outgoingContext: context,
      thread,
      shell,
      config,
      readConfig,
      ...(jevContext ? { context: jevContext } : {}),
      ...(onReviewPending ? { onReviewPending } : {}),
    });
    if (
      !useQueuedMessageStore
        .getState()
        .queuesByThreadKey[threadKey]?.some((entry) => entry.id === message.id)
    )
      return;

    // The server starts the turn with the thread's stored modes, so a change
    // made in the composer before queueing is saved first.
    const createdAt = new Date().toISOString();
    const metadataUpdate = shell
      ? resolveThreadMetadataUpdateForNextTurn({
          currentModelSelection: shell.modelSelection,
          nextModelSelection: routed.modelSelection,
          currentBranch: shell.branch,
        })
      : null;
    if (metadataUpdate) {
      await run(threadEnvironment.updateMetadata, {
        environmentId,
        input: { threadId, ...metadataUpdate },
      });
    }
    if (shell && shell.runtimeMode !== sendSettings.runtimeMode) {
      await run(threadEnvironment.setRuntimeMode, {
        environmentId,
        input: { threadId, runtimeMode: sendSettings.runtimeMode, createdAt },
      });
    }
    if (shell && shell.interactionMode !== sendSettings.interactionMode) {
      await run(threadEnvironment.setInteractionMode, {
        environmentId,
        input: { threadId, interactionMode: sendSettings.interactionMode, createdAt },
      });
    }
    if (
      isElectron &&
      useJevStore.getState().getThreadMode(environmentId, threadId) !== routingMode
    ) {
      throw new Error("Jev mode changed while this message was preparing. Use Send now to retry.");
    }

    // Stop hands a preparing message back to the composer. Past this point
    // the send can no longer be taken back.
    if (
      !queue.markDispatching(
        threadKey,
        message.id,
        createLocalDispatchSnapshot(thread ?? undefined),
      )
    )
      return;
    const dispatchedMessageId = newMessageId();
    const dispatch = {
      model: routed.modelSelection.model,
      effort: routed.modelSelection.options?.find((option) => option.id === "reasoningEffort")
        ?.value as string | undefined,
      threadId,
      messageId: dispatchedMessageId,
      environmentId,
      projectId: shell?.projectId ?? thread?.projectId,
    };
    if (routed.requestId && dispatch.projectId) {
      useJevStore.getState().recordPreparedDispatch(routed.requestId, {
        ...dispatch,
        projectId: dispatch.projectId,
        succeeded: null,
      });
    }
    // Servers from before inline context drop the records, so their turns
    // carry the payload in the text instead.
    const inlineContext = readConfig()?.environment.capabilities.inlineMessageContext === true;
    try {
      await run(threadEnvironment.startTurn, {
        environmentId,
        input: {
          threadId,
          message: {
            messageId: dispatchedMessageId,
            role: "user",
            text:
              context !== undefined && !inlineContext
                ? serializeLegacyContextMessage({ text, records: context.records })
                : text,
            attachments: wireAttachments,
            ...(context !== undefined && inlineContext ? { context } : {}),
          },
          modelSelection: routed.modelSelection,
          runtimeMode: sendSettings.runtimeMode,
          interactionMode: sendSettings.interactionMode,
          createdAt,
        },
      });
    } catch (error) {
      if (routed.requestId && dispatch.projectId) {
        useJevStore.getState().recordDispatch(routed.requestId, {
          ...dispatch,
          projectId: dispatch.projectId,
          succeeded: false,
        });
      }
      throw error;
    }
    if (routed.requestId && dispatch.projectId) {
      useJevStore.getState().recordDispatch(routed.requestId, {
        ...dispatch,
        projectId: dispatch.projectId,
        succeeded: true,
      });
    }
    queue.finishSend(threadKey, message.id);
    if (useUploads) releaseDraftAttachments(attachments);
    for (const image of message.images) revokeBlobPreviewUrl(image.previewUrl);
  } catch (error) {
    if (!queue.failSend(threadKey, message.id)) return;
    const title = readThreadShell(threadRef)?.title;
    toastManager.add({
      type: "error",
      title: title ? `Queued message not sent in "${title}"` : "Queued message not sent",
      description: error instanceof Error ? error.message : "Use Send now to try again.",
    });
  }
}
