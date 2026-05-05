# Echo Bot

Minimal t2a-chat host. Demonstrates:

- **Adapter pattern** — `createChatApp(options)` wires everything in ~30 lines
- **Form Block** — `enableFormBlocks: true` lets the LLM render interactive forms
- **System Event push** — `set_timer` tool fires a delayed event back into the conversation

## Run

```bash
cd examples/echo-bot
npm install
node server.js
# Open http://localhost:4000/chat — password can be anything (demo auth)
```
