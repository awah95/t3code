import { useMemo, useState } from "react";
import { derivePendingRequests } from "@t3tools/client-runtime/pending-requests";
import { ThreadId, type EnvironmentId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  buildPendingUserInputAnswers,
  setPendingUserInputCustomAnswer,
  togglePendingUserInputOptionSelection,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { Button } from "../ui/button";
import { ComposerPendingApprovalActions } from "./ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel";

export function SideChatPendingRequests({
  environmentId,
  threadId,
  activities,
}: {
  environmentId: EnvironmentId;
  threadId: string;
  activities: ReadonlyArray<OrchestrationThreadActivity>;
}) {
  const { approvals, userInputs } = useMemo(() => derivePendingRequests(activities), [activities]);
  const approval = approvals[0];
  const prompt = userInputs[0];
  const [answersByRequest, setAnswersByRequest] = useState<
    Record<string, Record<string, PendingUserInputDraftAnswer>>
  >({});
  const [responding, setResponding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const respondToApproval = useAtomCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondToUserInput = useAtomCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const dismissUserInput = useAtomCommand(threadEnvironment.dismissUserInput, {
    reportFailure: false,
  });
  const answers = prompt ? (answersByRequest[prompt.requestId] ?? {}) : {};
  const resolvedAnswers = prompt ? buildPendingUserInputAnswers(prompt.questions, answers) : null;

  async function submit(
    requestId: string,
    action: () => Promise<Awaited<ReturnType<typeof respondToApproval>>>,
  ) {
    if (responding) return;
    setResponding(requestId);
    setError(null);
    try {
      const result = await action();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to respond to this request.");
    } finally {
      setResponding(null);
    }
  }

  if (!approval && !prompt) return null;
  return (
    <div className="space-y-3 border-t px-3 py-3" aria-label="Side chat pending requests">
      {approval ? (
        <div className="space-y-2 rounded-md border border-warning/40 p-3">
          <ComposerPendingApprovalPanel approval={approval} pendingCount={approvals.length} />
          <div className="flex flex-wrap gap-2">
            <ComposerPendingApprovalActions
              requestId={approval.requestId}
              isResponding={responding === approval.requestId}
              options={approval.options}
              onRespondToApproval={async (requestId, decision) => {
                await submit(requestId, () =>
                  respondToApproval({
                    environmentId,
                    input: { threadId: ThreadId.make(threadId), requestId, decision },
                  }),
                );
              }}
            />
          </div>
        </div>
      ) : null}
      {prompt ? (
        <div className="space-y-3 rounded-md border p-3">
          <p className="text-xs font-medium">
            Question {userInputs.length > 1 ? `1/${userInputs.length}` : ""}
          </p>
          {prompt.questions.map((question) => (
            <div key={question.id} className="space-y-2">
              <p className="text-sm font-medium">{question.header}</p>
              <p className="text-sm">{question.question}</p>
              {question.options.map((option) => {
                const value = option.value ?? option.label;
                const selected =
                  answers[question.id]?.selectedOptionValues?.includes(value) ?? false;
                return (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={selected ? "default" : "outline"}
                    disabled={responding === prompt.requestId}
                    onClick={() =>
                      setAnswersByRequest((current) => ({
                        ...current,
                        [prompt.requestId]: {
                          ...current[prompt.requestId],
                          [question.id]: togglePendingUserInputOptionSelection(
                            question,
                            current[prompt.requestId]?.[question.id],
                            value,
                          ),
                        },
                      }))
                    }
                  >
                    {option.label}
                  </Button>
                );
              })}
              {question.allowCustomAnswer !== false ? (
                <textarea
                  className="min-h-16 w-full rounded-md border bg-background p-2 text-sm"
                  aria-label={`Answer: ${question.header}`}
                  value={answers[question.id]?.customAnswer ?? ""}
                  disabled={responding === prompt.requestId}
                  onChange={(event) =>
                    setAnswersByRequest((current) => ({
                      ...current,
                      [prompt.requestId]: {
                        ...current[prompt.requestId],
                        [question.id]: setPendingUserInputCustomAnswer(
                          current[prompt.requestId]?.[question.id],
                          event.target.value,
                        ),
                      },
                    }))
                  }
                />
              ) : null}
            </div>
          ))}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!resolvedAnswers || responding === prompt.requestId}
              onClick={() => {
                if (resolvedAnswers)
                  void submit(prompt.requestId, () =>
                    respondToUserInput({
                      environmentId,
                      input: {
                        threadId: ThreadId.make(threadId),
                        requestId: prompt.requestId,
                        answers: resolvedAnswers,
                      },
                    }),
                  );
              }}
            >
              Send answer
            </Button>
            {prompt.dismissible ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={responding === prompt.requestId}
                onClick={() =>
                  void submit(prompt.requestId, () =>
                    dismissUserInput({
                      environmentId,
                      input: { threadId: ThreadId.make(threadId), requestId: prompt.requestId },
                    }),
                  )
                }
              >
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
