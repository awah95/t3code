# Browser automation with Jev

Jev can choose browser actions while your coding agent handles the task, supplies text, and
checks the result. It uses the same signed-in preview browser as ordinary browser tools.

In the desktop app, add an OpenRouter key under **Settings → General → Jev Auto routing**.
Then open **Browser** in the thread header and turn on **Jev browser**. This is separate from
model routing and applies only to that environment and thread in the current client session.
Turning it off cancels Jev work; the ordinary browser tools remain available.

Ask for the task normally, including any exact text to enter. For example: “Filter the catalog
to Audio, search for Studio, and show only items in stock.” The agent can delegate the browser
steps together instead of deciding every click itself. Text and semantic page information are
sent to OpenRouter for these decisions, so use this only on pages you are comfortable sharing
with that service. The API key stays in the desktop's encrypted credential storage.

Jev works with supported page controls. Your agent takes over when a task needs new prose,
visual judgment, unsupported controls, or clarification. A proposed completion is not treated
as verified success. Tasks have step and time limits, and stale page state stops an action
from using an outdated target. Do not leave consequential tasks unattended.

The Browser panel shows recent actions and reported API cost. Unknown cost is not zero; a
cancelled request may still have been billed. These API charges are separate from your coding
provider subscription. The dollar limit is checked between decisions, not enforced by the
provider before billing a request.

A connected desktop host is required for Jev execution. Web and mobile clients do not store
the key or run a separate Jev browser engine. Computer-use automation and a standalone Jev
application are not included.
