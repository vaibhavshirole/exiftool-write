import exiftool from "./ex";
import { MemoryFileSystem, useMemoryFS } from "./wasi/features/fd";
import {
  useArgs,
  useClock,
  useEnviron,
  useProc,
  useRandom,
  WASI,
} from "./wasi";
import { instantiateStreaming } from "./wasi/asyncify";
import { WASIOptions } from "./wasi/options";
import { StringBuilder } from "./sb";

const cdn = "https://perl.objex.ai/zeroperl-1.0.0.wasm";
type FetchLike = (...args: any[]) => Promise<Response>;

/**
 * Configuration options for parsing file metadata with ExifTool
 * @template TReturn The type of the transformed output data
 */
export interface ExifToolOptions<TReturn> {
  /**
   * Additional command-line arguments to pass to ExifTool
   *
   * @example
   * // Extract specific tags
   * args: ["-Author", "-CreateDate"]
   *
   * @example
   * // Output as JSON
   * args: ["-json", "-n"]
   *
   * @see https://exiftool.org/exiftool_pod.html for all available options
   */
  args?: string[];

  /**
   * Custom fetch implementation for loading the WASM module
   *
   * Only needed for environments with custom fetch polyfills
   */
  fetch?: FetchLike;

  /**
   * Transform the raw ExifTool output into a different format
   *
   * @example
   * // Parse output as JSON
   * transform: (data) => JSON.parse(data)
   */
  transform?: (data: string) => TReturn;
}

const textDecoder = new TextDecoder();

/**
 * Represents a binary file for metadata extraction
 */
type Binaryfile = {
  /** Filename with extension (e.g., "image.jpg") */
  name: string;
  /** The binary content of the file */
  data: Uint8Array | Blob;
};

/**
 * Result of an ExifTool metadata extraction operation
 * @template TOutput The type of the output data after transformation
 */
type ExifToolOutput<TOutput> =
  | {
      /** True when metadata was successfully extracted */
      success: true;
      /** The extracted metadata, transformed if a transform function was provided */
      data: TOutput;
      /** Any warnings or info messages from ExifTool */
      error: string;
      /** Always 0 for success */
      exitCode: 0;
    }
  | {
      /** False when metadata extraction failed */
      success: false;
      /** No data available on failure */
      data: undefined;
      /** Error message explaining why the operation failed */
      error: string;
      /** Non-zero exit code indicating the type of failure */
      exitCode: number | undefined;
    };

/**
 * Extract metadata from a file using ExifTool
 *
 * @template TReturn Type of the returned data after transformation (defaults to string)
 * @param file File to extract metadata from
 * @param options Configuration options
 * @returns Promise resolving to the extraction result
 *
 * @example
 * // Basic usage with browser File object
 * const input = document.querySelector('input[type="file"]');
 * input.addEventListener('change', async () => {
 *   const file = input.files[0];
 *   const result = await parseMetadata(file);
 *   if (result.success) {
 *     console.log(result.data); // Raw ExifTool output as string
 *   }
 * });
 *
 * @example
 * // Extract specific tags and transform to JSON
 * const result = await parseMetadata(file, {
 *   args: ["-json"],
 *   transform: (data) => JSON.parse(data)
 * });
 * if (result.success) {
 *   console.log(result.data); // Typed access to specific metadata
 * }
 */
export async function parseMetadata<TReturn = string>(
  file: Binaryfile | File,
  options: ExifToolOptions<TReturn> = {}
): Promise<ExifToolOutput<TReturn>> {
  const fileSystem = new MemoryFileSystem({
    "/": "",
  });
  fileSystem.addFile("/exiftool", exiftool);
  if (file instanceof File) {
    fileSystem.addFile(`/${file.name}`, file);
  } else {
    fileSystem.addFile(`/${file.name}`, file.data);
  }
  const stdout = new StringBuilder();
  const stderr = new StringBuilder();
  const args = ["zeroperl", "exiftool"].concat(options.args || []);
  args.push(`/${file.name}`);
  const wasiOptions: WASIOptions = {
    env: {
      LC_ALL: "C",
      PERL_UNICODE: "SD",
    },
    args: args,
    features: [
      useEnviron,
      useArgs,
      useRandom,
      useClock,
      useProc,
      useMemoryFS({
        withFileSystem: fileSystem,
        withStdIo: {
          stdout: (str) => {
            if (ArrayBuffer.isView(str)) {
              str = textDecoder.decode(str);
            }
            if (StringBuilder.isMultiline(str)) {
              stdout.append(str);
            } else {
              stdout.appendLine(str);
            }
          },
          stderr: (str) => {
            if (ArrayBuffer.isView(str)) {
              str = textDecoder.decode(str);
            }
            if (StringBuilder.isMultiline(str)) {
              stderr.append(str);
            } else {
              stderr.appendLine(str);
            }
          },
        },
      }),
    ],
  };
  const wasi = new WASI(wasiOptions);
  const f = options.fetch ?? fetch;
  const { instance } = await instantiateStreaming(f(cdn), {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  const exitCode = await wasi.start(instance);
  if (exitCode !== 0) {
    return {
      success: false,
      data: undefined,
      error: stderr.toString(),
      exitCode,
    };
  }
  let data: TReturn;
  if (options.transform) {
    data = options.transform(stdout.toString());
  } else {
    data = stdout.toString() as unknown as TReturn;
  }
  return {
    success: true,
    data: data,
    error: stderr.toString(),
    exitCode,
  };
}
