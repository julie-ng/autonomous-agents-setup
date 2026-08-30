#!/usr/bin/env node

import { spawn } from "node:child_process";
import { Writable, Readable } from "node:stream";
import readline from "node:readline/promises";

import * as acp from "@agentclientprotocol/sdk";

class GooseClient implements acp.Client {
  async requestPermission(
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    console.log(`\n🔐 Permission requested: ${params.toolCall.title}`);

    console.log(`\nOptions:`);
    params.options.forEach((option, index) => {
      console.log(`   ${index + 1}. ${option.name} (${option.kind})`);
    });

    while (true) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await rl.question("\nChoose an option: ");
      const trimmedAnswer = answer.trim();
      rl.close();

      const optionIndex = parseInt(trimmedAnswer) - 1;
      if (optionIndex >= 0 && optionIndex < params.options.length) {
        return {
          outcome: {
            outcome: "selected",
            optionId: params.options[optionIndex].optionId,
          },
        };
      } else {
        console.log("Invalid option. Please try again.");
      }
    }
  }

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    const update = params.update;

    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text") {
          process.stdout.write(update.content.text);
        } else {
          console.log(`[${update.content.type}]`);
        }
        break;
      case "tool_call":
        console.log(`\n🔧 ${update.title} (${update.status})`);
        break;
      case "tool_call_update":
        console.log(
          `\n🔧 Tool call \`${update.toolCallId}\` updated: ${update.status}\n`,
        );
        break;
      case "plan":
      case "agent_thought_chunk":
      case "user_message_chunk":
        console.log(`[${update.sessionUpdate}]`);
        break;
      default:
        break;
    }
  }

  async writeTextFile(
    params: acp.WriteTextFileRequest,
  ): Promise<acp.WriteTextFileResponse> {
    // For a real controller you'd actually write the file here.
    // Left as a stub so you can see every tool call the agent makes
    // before wiring up real filesystem access.
    console.error(
      "[Client] Write text file called with:",
      JSON.stringify(params, null, 2),
    );
    return {};
  }

  async readTextFile(
    params: acp.ReadTextFileRequest,
  ): Promise<acp.ReadTextFileResponse> {
    console.error(
      "[Client] Read text file called with:",
      JSON.stringify(params, null, 2),
    );
    return {
      content: "Mock file content",
    };
  }
}

async function main() {
  // --- The only structural change from the SDK's example: spawn `goose acp`
  // instead of their example agent.ts. Everything downstream (the ACP
  // handshake, session lifecycle, message loop) is agent-agnostic ---
  const gooseProcess = spawn("goose", ["acp"], {
    stdio: ["pipe", "pipe", "inherit"], // inherit stderr so goose's own logs/errors surface in your terminal
    cwd: process.cwd(), // goose acp uses cwd for its workspace, same as `goose session`
  });

  gooseProcess.on("error", (err) => {
    console.error("[Client] Failed to spawn `goose acp` — is goose on PATH?", err);
    process.exit(1);
  });

  // Wrap the child process's stdio as Web Streams, same pattern as the SDK example
  const input = Writable.toWeb(gooseProcess.stdin!);
  const output = Readable.toWeb(
    gooseProcess.stdout!,
  ) as ReadableStream<Uint8Array>;

  const client = new GooseClient();
  const stream = acp.ndJsonStream(input, output);

  try {
    const promptResult = await acp
      .client({ name: "goose-controller" })
      .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
        client.requestPermission(ctx.params),
      )
      .onRequest(acp.methods.client.fs.writeTextFile, (ctx) =>
        client.writeTextFile(ctx.params),
      )
      .onRequest(acp.methods.client.fs.readTextFile, (ctx) =>
        client.readTextFile(ctx.params),
      )
      .connectWith(stream, async (ctx) => {
        const initResult = await ctx.request(acp.methods.agent.initialize, {
          protocolVersion: acp.PROTOCOL_VERSION,
          clientCapabilities: {
            fs: {
              readTextFile: true,
              writeTextFile: true,
            },
          },
        });

        console.log(
          `✅ Connected to goose (protocol v${initResult.protocolVersion})`,
        );

        return ctx.buildSession(process.cwd()).withSession(async (session) => {
          console.log(`📝 Created session: ${session.sessionId}`);

          // Swap this for whatever task text your webhook/controller wants to send.
          const taskPrompt = "Say hello and tell me what directory you're in.";
          console.log(`💬 Prompt: ${taskPrompt}\n`);

          session.prompt(taskPrompt);

          for (;;) {
            const message = await session.nextUpdate();
            if (message.kind === "stop") {
              return message.response;
            }
            await client.sessionUpdate(message.notification);
          }
        });
      });

    console.log(`\n\n✅ goose completed with: ${promptResult.stopReason}`);
  } catch (error) {
    console.error("[Client] Error:", error);
  } finally {
    gooseProcess.kill();
    process.exit(0);
  }
}

main().catch(console.error);
