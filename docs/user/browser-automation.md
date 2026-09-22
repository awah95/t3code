# Browser automation with Jev

Jev can choose browser actions while your coding agent handles the task, supplies text, and
checks the result. It uses the same signed-in preview browser as ordinary browser tools.

In the desktop app, add an OpenRouter key under **Settings → General → Jev Auto routing**.
Then open **Browser** in the thread header and turn on **Jev browser**. This is separate from
model routing and applies only to that environment and thread in the current client session.
Turning it off cancels Jev work; the ordinary browser tools remain available.
Use **Stop** to cancel the current task while keeping Jev enabled for the next one.
You can also stop an active browser task from its thread on mobile. Taking over the browser requires the desktop client.

Ask for the task normally, including any exact text to enter. For example: “Filter the catalog
to Audio, search for Studio, and show only items in stock.” The agent can delegate the browser
steps together instead of deciding every click itself. Text and semantic page information are
sent to OpenRouter for these decisions, so use this only on pages you are comfortable sharing
with that service. The API key stays in the desktop's encrypted credential storage.

Jev works with supported page controls. Your agent takes over when a task needs new prose,
visual judgment, unsupported controls, or clarification. A proposed completion is not treated
as verified success. Tasks have step and time limits, and stale page state stops an action
from using an outdated target. Do not leave consequential tasks unattended.

For repeatable QA, describe the starting state, exact values to enter, expected results, and
how to restore the original state. Break a larger flow into checks such as changing a setting,
verifying its effect, saving and reopening, then resetting it. Name the section containing a
control when several controls share a label. A changed input value alone does not prove that
the page rendered the expected result; ask your agent to check that separately. Content inside
cross-origin embedded frames and visual comparisons may still need the agent's ordinary
browser tools. Verification reports when it cannot inspect the requested scope instead of
treating missing information as a successful check.
Scripted popup windows are not task-owned automation targets. Complete those steps with the
agent or by taking control, then continue the task in the Browser panel.

Your agent can also extract a named table or list, select an option by its label, set a
checkbox to a desired state, and wait for a stated result. For file uploads, give it a file
in the thread's workspace or an attachment. Downloads are returned to the agent's environment
only after the browser finishes saving them. File selection alone does not confirm that a
form was submitted successfully.
If an action in the main page opens a confirmation dialog, the agent can inspect and handle that exact dialog.
It should then check the page's result before continuing; repeating the original action could
submit it twice.

The Browser panel shows recent actions and reported API cost. Unknown cost is not zero; a
cancelled request may still have been billed. These API charges are separate from your coding
provider subscription. The dollar limit is checked between decisions, not enforced by the
provider before billing a request.

When working remotely, ask the agent to open a port on its environment. A literal localhost
address opens a service on the desktop running the browser. Environment-relative ports need
a direct private-network connection; public relay connections do not expose development ports.

A connected desktop host is required for Jev execution. Web and mobile clients do not store
the key or run a separate Jev browser engine. Computer-use automation and a standalone Jev
application are not included.
