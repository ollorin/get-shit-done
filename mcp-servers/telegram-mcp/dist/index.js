import 'dotenv/config';
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { askBlockingQuestionHandler, checkQuestionAnswersHandler, markQuestionAnsweredHandler, ASK_QUESTION_TOOL_DEF, CHECK_ANSWERS_TOOL_DEF, MARK_ANSWERED_TOOL_DEF } from './tools/index.js';
import { startBot, stopBot } from './bot/telegram-bot.js';
import { REQUIREMENTS_RESOURCE_DEF, readRequirementsResource } from './resources/index.js';
// Create MCP server instance
const server = new Server({
    name: "telegram-mcp",
    version: "1.0.0"
}, {
    capabilities: {
        tools: {},
        resources: {}
    }
});
// Register tool list handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            ASK_QUESTION_TOOL_DEF,
            CHECK_ANSWERS_TOOL_DEF,
            MARK_ANSWERED_TOOL_DEF
        ]
    };
});
// Register tool call handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            case "ask_blocking_question":
                result = await askBlockingQuestionHandler(args);
                break;
            case "check_question_answers":
                result = await checkQuestionAnswersHandler(args);
                break;
            case "mark_question_answered":
                result = await markQuestionAnsweredHandler(args);
                break;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify(result)
                }
            ]
        };
    }
    catch (error) {
        // Return error in MCP format
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[MCP] Tool ${name} error:`, errorMessage);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        error: errorMessage,
                        tool: name
                    })
                }
            ],
            isError: true
        };
    }
});
// Register resource list handler
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [REQUIREMENTS_RESOURCE_DEF]
    };
});
// Register resource read handler
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    return readRequirementsResource(request.params.uri);
});
// Server lifecycle management
async function main() {
    console.error("[MCP] Starting Telegram MCP server...");
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[MCP] Server ready on stdio transport");
    console.error("[MCP] Tools: ask_blocking_question, check_question_answers, mark_question_answered");
    console.error("[MCP] Resources: telegram://requirements/new");
    // Start Telegram bot if token available
    if (process.env.TELEGRAM_BOT_TOKEN) {
        try {
            await startBot();
            console.error('[MCP] Telegram bot started');
        }
        catch (err) {
            console.error('[MCP] Bot start failed:', err.message);
            console.error('[MCP] Continuing without bot (tools will queue questions only)');
        }
    }
    else {
        console.error('[MCP] TELEGRAM_BOT_TOKEN not set, bot disabled');
        console.error('[MCP] Questions will be queued but not sent to Telegram');
    }
}
// Graceful shutdown
process.on("SIGINT", async () => {
    console.error("[MCP] Shutting down...");
    stopBot();
    process.exit(0);
});
process.on("SIGTERM", async () => {
    console.error("[MCP] Shutting down...");
    stopBot();
    process.exit(0);
});
// Error handling
main().catch((err) => {
    console.error("[MCP] Fatal error:", err);
    process.exit(1);
});
