# Room website extension

The landing page uses a dark blue device diagram, warm paper panels, thin rules, and a compact room launcher. The existing illustrative room walkthrough remains clearly labeled. The real room page keeps its existing room creation, memory pledges, model selection, invitations, chat, and coding agent bindings.

Added functionality:
- Join by a code, `/r/CODE` invitation, query link, or hash link. Only the validated code is used; navigation stays on this site.
- On-demand WebGPU compatibility check using the existing preflight probe.
- Browser origin storage usage/quota estimate, explicitly distinct from GPU memory.
- Trust and memory-pledge guidance on room onboarding.
- Local preview routes matching the production `/room` and `/r/CODE` routes.

Preview from the repository root: `python scripts/preview.py`, then open http://localhost:8089.

Checks: `node tests/invitation_node.mjs` (8 assertions); `node --check site/js/connect.js`. Browser checks verified invalid-code feedback, valid invitation navigation, WebGPU detection, and storage estimate. Narrow viewport visual review found and fixed inherited hero text shadow and hidden description rules. Live peer connectivity and model inference across separate GPUs have not been verified for this change. No website deployment was performed.
