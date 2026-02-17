/**
 * Resource definition for requirements
 */
export declare const REQUIREMENTS_RESOURCE_DEF: {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
};
/**
 * Resource read handler for requirements
 * @param uri Resource URI to read
 * @returns MCP resource response with JSONL content
 */
export declare function readRequirementsResource(uri: string): Promise<{
    contents: {
        uri: string;
        mimeType: string;
        text: string;
    }[];
}>;
