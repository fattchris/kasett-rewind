/**
 * Options for the generate-config command.
 */
export interface GenerateConfigOptions {
    /** Override window size (default: 3) */
    readonly windowSize?: number;
    /** Override thread tracking (default: true) */
    readonly threadTracking?: boolean;
    /** Override weights array */
    readonly weights?: readonly number[];
}
/**
 * Generates the full openclaw.json configuration output.
 * Validates all inputs and produces ready-to-paste JSON blocks.
 *
 * @param options - CLI flags parsed into options
 * @returns Formatted string output for the terminal
 * @throws KasettError on invalid configuration
 */
export declare function generateConfig(options: GenerateConfigOptions): string;
//# sourceMappingURL=generate-config.d.ts.map