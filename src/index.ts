import exiftool from "./ex";
import exiftoolRaw from "./ex"; // Import the raw string content
import { MemoryFileSystem, useMemoryFS } from "./wasi/features/fd";
import {
  useArgs,
  useClock,
  useEnviron,
  useProc,
  useRandom,
  WASI,
  WASIProcExit,
} from "./wasi";
import { instantiateStreaming } from "./wasi/asyncify";
import { WASIOptions } from "./wasi/options";
import { StringBuilder } from "./sb";

const cdn = "https://perl.objex.ai/zeroperl-1.0.0.wasm";
type FetchLike = (...args: any[]) => Promise<Response>;
const textDecoder = new TextDecoder();

/**
 * Configuration options for parsing file metadata with ExifTool
 * @template TReturn The type of the transformed output data
 */
interface ExifToolOptions<TReturn> {
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
 * Configuration options for writing file metadata with ExifTool
 */
interface ExifToolWriteOptions {
  /**
   * An array of tag assignment arguments to pass to ExifTool.
   * Each string should be in the format "-TAG=VALUE" or "-TAG<=VALUE".
   *
   * @example
   * tags: [
   *   "-XMP-GCamera:MicroVideo=1",
   *   "-XMP-GCamera:MicroVideoOffset=50000",
   *   "-Comment=Processed by Web App"
   * ]
   * @see https://exiftool.org/exiftool_pod.html#Writing-Meta-Information
   */
  tags: string[];

  /**
   * Optional: Provide a custom ExifTool config file as binary data.
   * Necessary for defining custom tags like XMP-GCamera.
   */
  configFile?: {
    /** Filename for the config file within the virtual environment (e.g., "my.config") */
    name: string;
    /** The binary content of the config file */
    data: Uint8Array;
  };

  /**
   * Custom fetch implementation (same as parseMetadata)
   */
  fetch?: FetchLike;

  /**
   * Addtional arguments *other* than tag assignments (e.g. -m, -q).
   * '-overwrite_original' is added automatically.
   * Avoid adding input/output filenames or tag assignments here.
   */
   extraArgs?: string[];
}

/**
 * Result of an ExifTool metadata writing operation
 */
type ExifToolWriteResult =
  | {
      /** True when metadata was successfully written */
      success: true;
      /** The binary data of the modified file */
      data: Uint8Array;
      /** Any warnings or info messages from ExifTool (stderr) */
      warnings: string;
      /** Always 0 for success */
      exitCode: 0;
    }
  | {
      /** False when metadata writing failed */
      success: false;
      /** No data available on failure */
      data: undefined;
      /** Error message explaining why the operation failed (stderr) */
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
async function parseMetadata<TReturn = string>(
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
      PERL_UNICODE: "SAD",
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

/**
 * Writes metadata to a file using ExifTool in Wasm.
 *
 * @param file The file to modify (as a browser File or a BinaryFile object).
 * @param options Configuration options including the tags to write.
 * @returns Promise resolving to the write result, containing the modified file data on success.
 *
 * @example
 * // Assuming 'jpegFile' is a File object and 'configData' is a Uint8Array of the config file
 * const result = await writeMetadata(jpegFile, {
 *   tags: [
 *     "-XMP-GCamera:MicroVideo=1",
 *     "-XMP-GCamera:MicroVideoOffset=123456",
 *     "-XMP-GCamera:MicroVideoPresentationTimestampUs=0"
 *   ],
 *   configFile: { name: "google.config", data: configData },
 *   extraArgs: ["-m", "-q"] // Ignore minor errors, be quiet
 * });
 *
 * if (result.success) {
 *   // result.data contains the Uint8Array of the modified file
 *   const blob = new Blob([result.data], { type: jpegFile.type });
 *   // Now you can offer the blob for download
 *   console.log("Metadata written successfully!");
 * } else {
 *   console.error("Error writing metadata:", result.error);
 * }
 */
async function writeMetadata(
  file: Binaryfile | File,
  options: ExifToolWriteOptions
): Promise<ExifToolWriteResult> {

  // 1. Initialize MemoryFileSystem
  const fileSystem = new MemoryFileSystem({ "/": "" });

  // 2. Prepare and add ExifTool script data
  let exiftoolData: Uint8Array;
  if (typeof exiftoolRaw === 'string') {
    exiftoolData = new TextEncoder().encode(exiftoolRaw);
  } else {
      console.error("Unexpected type for imported exiftool script data:", typeof exiftoolRaw);
      return { success: false, data: undefined, error: "Internal error: ExifTool script data is not a string.", exitCode: undefined };
  }
  fileSystem.addFile("/exiftool", exiftoolData);

  // 3. Prepare and add the input file data
  const inputFilename = file instanceof File ? file.name : file.name;
  const sanitizedInputFilename = inputFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Define distinct input and output paths in the virtual FS
  const inputFilePath = `/source_${sanitizedInputFilename}`; // e.g., /source_image.jpg
  const outputFilePath = `/output_${sanitizedInputFilename}`; // e.g., /output_image.jpg

  const fileData = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.data;
  if (!(fileData instanceof Uint8Array) && !(fileData instanceof Blob)) {
      return { success: false, data: undefined, error: "Input file data must be Uint8Array or Blob.", exitCode: undefined };
  }
  fileSystem.addFile(inputFilePath, fileData); // Add the input file

  // 4. Add the config file to virtual FS (if provided)
  let configFilePath: string | undefined; // Still need the path
  if (options.configFile) {
    if (!(options.configFile.data instanceof Uint8Array)) {
       return { success: false, data: undefined, error: "Config file data must be Uint8Array.", exitCode: undefined };
    }
    configFilePath = `/${options.configFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fileSystem.addFile(configFilePath, options.configFile.data);
  } else {
    // If custom tags are used, a config file is mandatory
    // Add a check here if your logic depends on the config file always being present for certain tags
    console.warn("Writing custom XMP tags but no config file provided. This might fail if tags are undefined.");
    // Optionally return an error:
    // return { success: false, data: undefined, error: "Config file required for custom tags.", exitCode: undefined };
  }

  // 5. Construct the command-line arguments for writing
  const exiftoolArgs = ["zeroperl", "exiftool"]; // Base command

  // --- DO NOT ADD -config TO ARGUMENTS ---
  // if (configFilePath) {
  //   exiftoolArgs.push("-config");
  //   exiftoolArgs.push(configFilePath);
  // }

  // --- Add other arguments ---
  exiftoolArgs.push(...(options.extraArgs || []));
  exiftoolArgs.push(...options.tags);
  exiftoolArgs.push("-o", outputFilePath);
  exiftoolArgs.push(inputFilePath);

  // 6. Setup WASI environment
  const stderr = new StringBuilder();

  // --- Define the environment variables ---
  const wasiEnv = {
    LC_ALL: "C",
    PERL_UNICODE: "SAD",
    // --- ADD EXIFTOOL_CONFIG if config file exists ---
    ...(configFilePath && { EXIFTOOL_CONFIG: configFilePath })
  };
  // --- Log the environment being passed ---
  console.log("[DEBUG] WASI Environment:", wasiEnv);

  const wasiOptions: WASIOptions = {
    env: wasiEnv, // Pass the constructed environment
    args: exiftoolArgs,
    features: [
      useEnviron, // Make sure useEnviron is included to process the env object
      useArgs, useRandom, useClock, useProc,
      useMemoryFS({
        withFileSystem: fileSystem,
        withStdIo: { stderr: (str) => { /* capture stderr */
             if (ArrayBuffer.isView(str)) str = textDecoder.decode(str);
             if (StringBuilder.isMultiline(str)) stderr.append(str); else stderr.appendLine(str);
         }, stdout: () => {} }
      })
    ]
  };
  const wasi = new WASI(wasiOptions); // Pass the full options here

  // 7. Fetch and instantiate Wasm (same as before)
  const f = options.fetch ?? fetch;
  let instance: WebAssembly.Instance;
  try {
      instance = (await instantiateStreaming(f(cdn), { wasi_snapshot_preview1: wasi.wasiImport })).instance;
  } catch (err) {
      const message = (err instanceof Error) ? err.message : String(err);
      return { success: false, data: undefined, error: `Wasm instantiation failed: ${message}`, exitCode: undefined };
  }

  // 8. Run the Wasm process (same as before)
  let exitCode: number | undefined;
  let runError: Error | WASIProcExit | unknown | undefined;
  try {
      exitCode = await wasi.start(instance);
  } catch (err) {
      runError = err;
      if (err instanceof WASIProcExit) exitCode = err.code;
      else exitCode = undefined; // Unknown exit code on other errors
  }

  const stderrOutput = stderr.toString();

  // 9. Check exit code and handle errors (same as before)
  if (exitCode !== 0) {
      let errorMsg = stderrOutput;
      if (!errorMsg) {
          if (runError && !(runError instanceof WASIProcExit)) {
               const message = (runError instanceof Error) ? runError.message : String(runError);
               errorMsg = `WASI start failed: ${message}`;
          } else { errorMsg = `ExifTool exited with code ${exitCode}`; }
      }
      console.error(`ExifTool process failed. Exit code: ${exitCode}. Stderr:\n${stderrOutput}`);
      return { success: false, data: undefined, error: errorMsg, exitCode };
  }

  // 10. Retrieve the *output* file data from the virtual filesystem
  let modifiedFileData: Uint8Array | undefined;
  try {
      // --- Lookup the DEFINED OUTPUT PATH ---
      const node = fileSystem.lookup(outputFilePath);

      if (!node) {
          // If exiftool succeeded (exit 0) but output file doesn't exist, something is wrong.
          throw new Error(`Output file node not found at path: ${outputFilePath} despite exit code 0.`);
      } else if (node.type !== 'file') {
          throw new Error(`Output node at path ${outputFilePath} is not a file (type: ${node.type})`);
      } else {
          const fileContent = node.content;
          if (fileContent instanceof Uint8Array) {
              modifiedFileData = fileContent;
          } else if (fileContent instanceof Blob) {
              console.log("[DEBUG] Retrieved output file content as Blob, converting to Uint8Array.");
              modifiedFileData = new Uint8Array(await fileContent.arrayBuffer());
          } else { throw new Error(`Unexpected content type for output file node at ${outputFilePath}`); }
      }
  } catch(lookupError) {
       const message = (lookupError instanceof Error) ? lookupError.message : String(lookupError);
       console.error(`Failed to retrieve output file from virtual FS at ${outputFilePath}:`, message);
       return { success: false, data: undefined, error: `Internal error retrieving output: ${message}. Warnings: ${stderrOutput}`, exitCode: 0 };
  }

  // Final check
  if (!modifiedFileData) {
       console.error(`ExifTool reported success (exit 0), but failed to retrieve valid output file data at ${outputFilePath}.`);
        return { success: false, data: undefined, error: `Internal error: Output data retrieval failed despite exit code 0. Warnings: ${stderrOutput}`, exitCode: 0 };
  }

  // 11. Return success with the output data
  console.log(`[DEBUG] Successfully retrieved output file data from ${outputFilePath}. Size: ${modifiedFileData.byteLength} bytes.`);
  return {
    success: true,
    data: modifiedFileData, // This is the content of the *new* output file
    warnings: stderrOutput,
    exitCode: 0,
  };
}

export { parseMetadata, writeMetadata };
export type { ExifToolOptions, ExifToolOutput, ExifToolWriteOptions, ExifToolWriteResult, Binaryfile };