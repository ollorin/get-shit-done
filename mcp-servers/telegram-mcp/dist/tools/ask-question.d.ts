/**
 * Input schema for ask_blocking_question tool
 */
export interface AskQuestionInput {
    question: string;
    context?: string;
    timeout_minutes?: number;
}
/**
 * Output schema for ask_blocking_question tool
 */
export interface AskQuestionOutput {
    question_id: string;
    asked_at: string;
    status: "pending";
}
/**
 * MCP tool definition for ask_blocking_question
 */
export declare const ASK_QUESTION_TOOL_DEF: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            question: {
                type: string;
                description: string;
            };
            context: {
                type: string;
                description: string;
            };
            timeout_minutes: {
                type: string;
                description: string;
                default: number;
            };
        };
        required: string[];
    };
};
/**
 * Handler for ask_blocking_question tool
 *
 * Creates a pending question in the JSONL queue and sends to Telegram.
 *
 * @param args Input arguments conforming to AskQuestionInput
 * @returns Output conforming to AskQuestionOutput
 * @throws Error if validation fails
 */
export declare function askBlockingQuestionHandler(args: unknown): Promise<AskQuestionOutput>;
