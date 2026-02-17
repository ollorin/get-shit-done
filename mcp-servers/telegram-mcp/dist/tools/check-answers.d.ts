/**
 * Input schema for check_question_answers tool
 */
export interface CheckAnswersInput {
    question_ids?: string[];
    wait_seconds?: number;
}
/**
 * Output schema for check_question_answers tool
 */
export interface CheckAnswersOutput {
    answers: Array<{
        question_id: string;
        question: string;
        answer: string;
        answered_at: string;
    }>;
    pending_count: number;
}
/**
 * MCP tool definition for check_question_answers
 */
export declare const CHECK_ANSWERS_TOOL_DEF: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            question_ids: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            wait_seconds: {
                type: string;
                description: string;
                default: number;
                maximum: number;
            };
        };
    };
};
/**
 * Handler for check_question_answers tool
 *
 * Checks for answered questions with optional long polling.
 * If wait_seconds > 0, polls every 5 seconds until answers found or timeout.
 *
 * @param args Input arguments conforming to CheckAnswersInput
 * @returns Output conforming to CheckAnswersOutput
 */
export declare function checkQuestionAnswersHandler(args: unknown): Promise<CheckAnswersOutput>;
