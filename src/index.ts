import exiftool from "./ex";
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

const textEncoder = new TextEncoder();
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
 * Writes metadata to a file using ExifTool running in WebAssembly.
 * Creates a new file in memory with the modifications.
 *
 * @param file The file to modify (browser File or { name: string, data: Uint8Array | Blob }).
 * @param options Options: tags to write, optional config file, extra ExifTool args.
 * @returns Promise resolving to the result, containing the modified file data on success.
 * 
 * @example
 * 
 * 1. Input file as File obj
 * let selectedFile: File | null = null; 
 * 
 * 2. (optional) config file for custom tags
 * const configFileContent = await loadConfigFile('/google.config');
 * 
 * 3. Set up descriptors
 * const options: ExifToolWriteOptions = {
 *   tags: ["-XMP-GCamera:MicroVideo=1", "-XMP-GCamera:MicroVideoVersion=1"],
 *   extraArgs: ["-m", "-q"],
 *   configFile: configFileContent,
 * };
 * 
 * 4. Call function
 * const result = await writeMetadata(selectedFile, options);
 * 
 * if (result.success) {
 *   console.log("Modified file size: ", result.data.byteLength);
 *   const blob = new Blob([result.data], { type: selectedFile.type });
 * }
 */
async function writeMetadata(
  file: Binaryfile | File,
  options: ExifToolWriteOptions
): Promise<ExifToolWriteResult> {
 
  /* 1. Prepare and add ExifTool Perl script */
  const fileSystem = new MemoryFileSystem({ "/": "" }); //Initialize Virtual Filesystem in memory for WASM process

  let exiftoolData: Uint8Array;
  if (typeof exiftool === 'string') {                   // `exiftool` is a string containing the Perl script
    exiftoolData = textEncoder.encode(exiftool);        // Convert UTF-8 string to bytes for virtual filesystem
  } else {
      console.error("Unexpected type for imported exiftool script data:", typeof exiftool);
      return { success: false, data: undefined, 
        error: "Internal error: ExifTool script data is not a string.", exitCode: undefined };
  }
  fileSystem.addFile("/exiftool", exiftoolData);        // Add script to vritual filesystem

  /* 2. Prepare and add input file data */
  const inputFilename = file instanceof File ? file.name : file.name;             // Get filename
  const sanitizedInputFilename = inputFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const inputFilePath = `/source_${sanitizedInputFilename}`;                      // ExifTool reads here
  const outputFilePath = `/output_${sanitizedInputFilename}`;                     // ExifTool writes here

  const fileData = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.data; // File data as bytes
  if (!(fileData instanceof Uint8Array) && !(fileData instanceof Blob)) {
      return { success: false, data: undefined, 
        error: "Input file data must be Uint8Array or Blob.", exitCode: undefined };
  }

  fileSystem.addFile(inputFilePath, fileData);  // Add input file data to virtual filesystem

  /* 3. Prepare and add config file (optional) */
  let configFilePath: string | undefined; 
  if (options.configFile) {
    if (!(options.configFile.data instanceof Uint8Array)) {
       return { success: false, data: undefined, 
        error: "Config file data must be Uint8Array.", exitCode: undefined };
    }

    configFilePath = `/${options.configFile.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    fileSystem.addFile(configFilePath, options.configFile.data);
  } else {
    console.warn("Writing metadata, possibly custom tags, \
      but no config file provided via options.configFile. \
      This might fail if tags are undefined by ExifTool.");
  }

  /* 4. Construct exiftool args to pass to `zeroperl /exiftool` command inside WASI */
  const exiftoolArgs = [
      "zeroperl",                   // The Perl interpreter Wasm binary command
      "exiftool",                   // The virtual path to the ExifTool Perl script
      ...(options.extraArgs || []), 
      ...(options.tags || []),
      "-o", outputFilePath,         // Tell ExifTool to write output to this *new* virtual path
      inputFilePath                 // Specify the virtual input file path
  ];
  // NOTE: NOT using `-overwrite_original` or `-overwrite_original_in_place`.
  // NOTE: NOT using the `-config` command-line argument here.

  /* 5. Setup WASI environment */
  const stderr = new StringBuilder(); // Utility to collect stderr output as a string

  // NOTE:
  // Define environment variables for the Wasm process.
  // The EXIFTOOL_CONFIG environment variable is used to specify the config file path,
  // bypassing issues with the `-config` command-line argument order.
  const wasiEnv = {
    LC_ALL: "C",         // Standard locale settings
    PERL_UNICODE: "SAD", // Perl Unicode settings
    // Conditionally add EXIFTOOL_CONFIG using spread syntax if configFilePath is set.
    ...(configFilePath && { EXIFTOOL_CONFIG: configFilePath })
  };
  console.log("[DEBUG] WASI Environment:", wasiEnv); // Log for debugging

  // Combine all WASI options and create instance
  const wasiOptions: WASIOptions = {
    env: wasiEnv,       // Environment variables defined above
    args: exiftoolArgs, // Command-line arguments defined above
    features: [         // Specify which WASI features to enable
      useEnviron,       // Enables environment variable support (`env`)
      useArgs,          // Enables command-line argument support (`args`)
      useRandom,        // Provides random number generation
      useClock,         // Provides time/clock access
      useProc,          // Provides process exit (`proc_exit`)
      useMemoryFS({     // Enables filesystem access using our virtual `MemoryFileSystem`
        withFileSystem: fileSystem, // Provide the filesystem instance we created
        withStdIo: {                // Configure standard input/output/error
          // Capture stderr: Decode bytes to string and append to our StringBuilder.
          stderr: (str) => {
             if (ArrayBuffer.isView(str)) str = textDecoder.decode(str);
             if (StringBuilder.isMultiline(str)) stderr.append(str); else stderr.appendLine(str);
          },
          stdout: () => {} // We don't expect relevant stdout, so ignore it.
        }
      })
    ]
  };
  const wasi = new WASI(wasiOptions);

  /* 6. Instantiate WASM module */
  const f = options.fetch ?? fetch;
  let instance: WebAssembly.Instance;
  try {
      const result = await instantiateStreaming(f(cdn), {
          wasi_snapshot_preview1: wasi.wasiImport,
      });
      instance = result.instance; // The running instance of the Wasm module
  } catch (err) {
      const message = (err instanceof Error) ? err.message : String(err);
      return { success: false, data: undefined, error: `Wasm instantiation failed: ${message}`, exitCode: undefined };
  }

  /* 7. Run WASM process */
  let exitCode: number | undefined;
  let runError: Error | WASIProcExit | unknown | undefined;
  try {
      // `wasi.start` runs the `_start` function. It returns the exit code if the process
      // exits normally, or throws an error (like `WASIProcExit`) if it terminates abnormally.
      exitCode = await wasi.start(instance);
  } catch (err) {
      // Catch errors during Wasm execution.
      runError = err;
      if (err instanceof WASIProcExit) {
          // If it's a controlled exit (e.g., `exit(1)` called in Perl), get the code.
          exitCode = err.code;
          console.log(`WASI process exited via proc_exit with code: ${exitCode}`);
      } else {
          // For other unexpected errors, the exit code is unknown.
          console.error("Error during wasi.start:", err);
          exitCode = undefined;
      }
  }

  // Get all captured stderr output.
  const stderrOutput = stderr.toString();

  /* 8. Check resultcode and errors */
  // ExifTool return: 0-success, 1-errors/warnings, 2-condition fail.
  if (exitCode !== 0) {
      let errorMsg = stderrOutput;
      if (!errorMsg) { // If stderr was empty, use info from the runtime error.
          if (runError && !(runError instanceof WASIProcExit)) {
               const message = (runError instanceof Error) ? runError.message : String(runError);
               errorMsg = `WASI execution failed: ${message}`;
          } else {
               // Default message if no specific error details are available.
               errorMsg = `ExifTool process exited with code ${exitCode}`;
          }
      }
      console.error(`ExifTool process failed. Exit code: ${exitCode}. Stderr:\n${stderrOutput}`);

      return { success: false, data: undefined, error: errorMsg, exitCode };
  }

  /* 9. Get output file data from virtual filesystem */
  let modifiedFileData: Uint8Array | undefined;
  try {
      const node = fileSystem.lookup(outputFilePath);

      // Check if the node was found and is a file.
      if (!node) {
          throw new Error(`Output file node not found at path: ${outputFilePath} despite exit code 0.`);
      } else if (node.type !== 'file') {
          throw new Error(`Output node at path ${outputFilePath} is not a file (type: ${node.type})`);
      } else {
          // Access the file content. It should be Uint8Array or potentially Blob.
          const fileContent = node.content;
          if (fileContent instanceof Uint8Array) {
              // If it's already bytes, use it directly.
              modifiedFileData = fileContent;
          } else if (fileContent instanceof Blob) {
              // If it's a Blob, convert it to bytes (Uint8Array). `await` is needed here.
              console.log("[DEBUG] Retrieved output file content as Blob, converting to Uint8Array.");
              modifiedFileData = new Uint8Array(await fileContent.arrayBuffer());
          } else {
              // Should not happen based on `FileNode` definition.
              throw new Error(`Unexpected content type for output file node at ${outputFilePath}`);
          }
      }
  } catch(lookupError) {
      // Handle errors during file retrieval from the virtual filesystem.
       const message = (lookupError instanceof Error) ? lookupError.message : String(lookupError);
       console.error(`Failed to retrieve output file from virtual FS at ${outputFilePath}:`, message);
       // Return failure, including any stderr warnings from ExifTool.
       return { success: false, data: undefined, 
        error: `Internal error retrieving output: ${message}. 
        Warnings: ${stderrOutput}`, exitCode: 0 }; // Exit code was 0, but retrieval failed
  }

  // Final check
  if (!modifiedFileData) {
       console.error(`ExifTool reported success (exit 0), but failed to retrieve valid output file data at ${outputFilePath}.`);
        return { success: false, data: undefined, 
          error: `Internal error: Output data retrieval failed despite exit code 0. Warnings: ${stderrOutput}`, exitCode: 0 };
  }

  /* 10. Return result object with filedata */
  console.log(`[DEBUG] Successfully retrieved output file data from ${outputFilePath}. Size: ${modifiedFileData.byteLength} bytes.`);
  return {
    success: true,
    data: modifiedFileData, // The binary content of the output file
    warnings: stderrOutput, // Include any warnings from ExifTool's stderr
    exitCode: 0,
  };
}

export { parseMetadata, writeMetadata };
export type { ExifToolOptions, ExifToolOutput, ExifToolWriteOptions, ExifToolWriteResult, Binaryfile };