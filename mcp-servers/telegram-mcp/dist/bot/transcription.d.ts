/**
 * Whisper Transcription Module
 *
 * Lazy-load whisper-node to avoid cwd corruption at module load time.
 * (whisper-node changes process.cwd() when imported, breaking path resolution)
 */
export declare const WHISPER_MODEL = "base.en";
/**
 * Transcribe audio file using local Whisper model
 * @param audioUrl - URL to download audio from
 * @returns Transcribed text
 */
export declare function transcribeAudio(audioUrl: string): Promise<string>;
/**
 * Check if Whisper model is available
 */
export declare function checkWhisperModel(): Promise<{
    available: boolean;
    path?: string;
    message?: string;
}>;
