# Cumea v0.2 — X launch draft

Status: **draft only**. Nothing in this file has been posted.

## Thread

**1/8**

I built Cumea: an open-source, local-first team of named AI agents.

Each agent can use a different model or CLI subscription, work on your Mac or your own VM, collaborate with other agents over ACP/MCP, and stay reachable from mobile.

https://github.com/metaforismo/Cumea

**2/8**

Cumea started from OpenMausBot by @milindlabs, whose MIT history and notice remain in the repo. I also learned a lot from @elie2222's Rakazo and its clean adapter boundaries.

Thank you both for pushing this open-source agent category forward.

**3/8**

The interface is organized around teammates, not an endless pile of chats. But one agent should still be able to multitask.

So Cumea adds a FIFO task queue, Fresh context, editable message branches, and disposable 24-hour Quick bots for clean context boundaries.

**4/8**

Bring the tools you already pay for: Claude Code, Codex, Grok, Gemini, or another compatible ACP CLI.

Model selection is per agent. Local CLI subscriptions stay distinct from API billing, and custom ACP profiles are explicit, validated, and local-only.

**5/8**

Agents can work together without making you the router.

Every compatible agent gets bounded `list_bots` and `ask_bot` tools, visible handoff cards, and the computer MCP selected for that agent. Delegation is useful; infinite agent-to-agent loops are not.

**6/8**

The less flashy work matters too: Needs you approvals, per-agent policies, routines, safe MD/PDF/DOCX previews, native dictation, durable task/run evidence, animated Mote avatars, and transactional cleanup when an agent is deleted.

**7/8**

Cumea does not sell you another opaque cloud computer. It runs on hardware you control: this Mac or your own always-on VM.

The Expo mobile app pairs with that host using a revocable device token, then gives you the same agent-first home, chat, queue, and approvals.

**8/8**

This is a v0.2 developer-preview candidate: the macOS build is currently unsigned/unnotarized, and mobile has been validated in an iOS Simulator rather than claimed as physical-device proof.

If this direction is useful, I would love feedback, issues, and contributors.

