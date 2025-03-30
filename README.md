# @uswriting/exiftool

[ExifTool](https://exiftool.org) (13.11) powered by WebAssembly to extract metadata from files in browsers and Node.js environments using [zeroperl](https://github.com/uswriting/zeroperl).

## Installation

```
npm install @uswriting/exiftool
```

## Description

This package provides a WebAssembly-based implementation of ExifTool that works in both browser and Node.js environments. It leverages [zeroperl](https://github.com/uswriting/zeroperl) to execute ExifTool without requiring any native binaries or system dependencies.

## Writing Metadata with `writeMetadata`
**[Sample website `exiftool-write-test` to demonstrate usage](https://github.com/vaibhavshirole/LivePhotoBridge/tree/main/exiftool-write-test)**

This fork includes a `writeMetadata` function to modify metadata in files using ExifTool, running entirely client-side via WebAssembly. 
It works by creating a *new* file in memory with the specified metadata changes applied.


**Synopsis:**

```typescript
import { writeMetadata, ExifToolWriteOptions, ExifToolWriteResult, Binaryfile } from '@uswriting/exiftool';

async function writeMetadata(
  file: Binaryfile | File,
  options: ExifToolWriteOptions
): Promise<ExifToolWriteResult>
```

**How it Works Internally:**

The function performs these steps:

1.  Creates a temporary in-memory virtual filesystem (using WASI `MemoryFileSystem`).
2.  Loads the provided input `file` data into this virtual filesystem (e.g., at `/source_image.jpg`).
3.  Loads the ExifTool perl script and the optional `configFile` into the virtual filesystem.
4.  Constructs ExifTool command-line arguments including:
    *   Tag assignments specified in `options.tags` (e.g., `-Comment=New`).
    *   The `-o /output_image.jpg` flag, instructing ExifTool to write the result to a *new* file within the virtual filesystem.
    *   The path to the input file in the virtual filesystem (e.g., `/source_image.jpg`).
    *   **Note:** It does *not* use `-overwrite_original`.
5.  Sets the `EXIFTOOL_CONFIG` environment variable if `options.configFile` is provided.
6.  Executes ExifTool via the `zeroperl.wasm` runtime within the configured WASI environment.
7.  If ExifTool exits successfully (code 0), it retrieves the binary data of the *output file* (e.g., `/output_image.jpg`) from the virtual filesystem.
8.  Returns the result, including the binary data of the newly created file with modified metadata.

**Parameters:**

*   `file`: (`File | Binaryfile`)
    *   The input file containing the original metadata. This can be a standard browser `File` object (from an `<input type="file">`) or a `Binaryfile` object (`{ name: string; data: Uint8Array | Blob }`).
    *   **This original file object is NOT modified.**
*   `options`: (`ExifToolWriteOptions`)
    *   An object containing configuration for the write operation:
    *   `tags`: (`string[]`) - **Required**. An array of strings, where each string is a complete ExifTool tag assignment argument.
        *   Examples: `"-Comment=My Description"`, `"-Artist=John Doe"`, `"-XMP-dc:Subject=Testing"`, `"-GPSLatitudeRef=N"`, `"-AllDates-=1:0:0"`
    *   `configFile` (`{ name: string; data: Uint8Array }`) - **Optional, but required for custom tags**. An object containing:
        *   `name`: The desired filename for the config file within the virtual filesystem (e.g., `"my.config"`).
        *   `data`: The binary content (`Uint8Array`) of the ExifTool configuration file. This file *must* define any custom tags (like `XMP-GCamera`) you intend to write. You typically need to fetch this file's content first.
    *   `extraArgs` (`string[]`) - **Optional**. An array of additional ExifTool command-line flags (e.g., `["-m", "-q"]` to ignore minor errors and run quietly). Do not include `-config`, `-o`, overwrite_original`, input/output filenames, or tag assignments here.
    *   `fetch` (`FetchLike`) - **Optional**. A custom `fetch`-compatible function, usually only needed in specific non-browser environments. Defaults to the global `fetch`.

**Return Value:**

*   `Promise<ExifToolWriteResult>`: A Promise that resolves to an object describing the outcome:
    *   On **Success**:
        ```typescript
        {
          success: true;
          data: Uint8Array; // The binary data of the NEW file with modified metadata
          warnings: string;  // Any warning messages from ExifTool's stderr output
          exitCode: 0;
        }
        ```
    *   On **Failure**:
        ```typescript
        {
          success: false;
          data: undefined;
          error: string;     // Error message (usually from ExifTool stderr or internal error)
          exitCode: number | undefined; // ExifTool's non-zero exit code, or undefined if Wasm failed before exit
        }
        ```

**Prerequisites:**

*   The `zeroperl.wasm` runtime must be accessible (typically via the default CDN URL or fetched).
*   If writing custom/user-defined tags, you **must** provide the corresponding ExifTool configuration file via the `options.configFile` parameter.

**Usage Examples:**

**1. Writing Standard Tags (e.g., Comment, Author)**

```typescript
// Assuming 'selectedFile' is a File object from an <input>
// and 'writeMetadata' is imported.

async function handleWriteStandardTags() {
  if (!selectedFile) return;

  const tagsToWrite = [
    `-Comment=Processed on ${new Date().toISOString()}`,
    "-Author=Vaibhav",
    "-Copyright=2025"
  ];

  const options: ExifToolWriteOptions = {
    tags: tagsToWrite,
    extraArgs: ["-m"] // Ignore minor errors
  };

  statusDiv.textContent = "Writing standard tags..."; // Update UI

  try {
    const result = await writeMetadata(selectedFile, options);

    if (result.success) {
      statusDiv.textContent = `Success! Warnings: ${result.warnings || 'None'}`;
      console.log("Modified data size:", result.data.byteLength);

      // Create a downloadable Blob from the NEW file data
      const blob = new Blob([result.data], { type: selectedFile.type });
      const url = URL.createObjectURL(blob);
      // Offer download link (logic depends on your UI framework)
      // setupDownloadLink(url, `modified_${selectedFile.name}`);

    } else {
      statusDiv.textContent = `Error writing tags: ${result.error} (Code: ${result.exitCode})`;
      console.error("Write failed:", result);
    }
  } catch (error) {
      const message = (error instanceof Error) ? error.message : String(error);
      statusDiv.textContent = `JavaScript Error: ${message}`;
      console.error("Error calling writeMetadata:", error);
  }
}
```

**2. Writing Custom XMP Tags (e.g., XMP-GCamera)**

```typescript
// Assuming 'selectedFile' is a File object, 'writeMetadata' is imported,
// and you have a 'google.config' file in your web server's public directory.

// Helper to fetch the config file
async function loadConfigFile(url: string): Promise<{ name: string; data: Uint8Array } | undefined> {
  try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${url}`);
      const arrayBuffer = await response.arrayBuffer();
      const fileName = url.substring(url.lastIndexOf('/') + 1);
      return { name: fileName, data: new Uint8Array(arrayBuffer) };
  } catch (e) {
      console.error(`Failed to load config file from ${url}:`, e);
      return undefined;
  }
}

async function handleWriteGCameraTags() {
  if (!selectedFile) return;

  statusDiv.textContent = "Loading config file...";
  const configFileContent = await loadConfigFile('/google.config'); // Adjust path if needed

  if (!configFileContent) {
      statusDiv.textContent = 'Error: Could not load google.config. Required for custom tags.';
      return;
  }

  statusDiv.textContent = "Config loaded. Writing GCamera tags...";

  // Example GCamera tags
  const dummyOffset = 123456;
  const dummyTimestamp = 98765;
  const tagsToWrite = [
    "-XMP-GCamera:MicroVideo=1",
    "-XMP-GCamera:MicroVideoVersion=1",
    `-XMP-GCamera:MicroVideoOffset=${dummyOffset}`,
    `-XMP-GCamera:MicroVideoPresentationTimestampUs=${dummyTimestamp}`,
  ];

  const options: ExifToolWriteOptions = {
    tags: tagsToWrite,
    configFile: configFileContent, // Provide the loaded config file!
    extraArgs: ["-m", "-q"]
  };

  try {
    const result = await writeMetadata(selectedFile, options);

    if (result.success) {
      statusDiv.textContent = `Success! GCamera tags written. Warnings: ${result.warnings || 'None'}`;
      console.log("Modified data size:", result.data.byteLength);

      // Offer download
      const blob = new Blob([result.data], { type: selectedFile.type });
      const url = URL.createObjectURL(blob);
      // setupDownloadLink(url, `gcam_modified_${selectedFile.name}`);

    } else {
      statusDiv.textContent = `Error writing GCamera tags: ${result.error} (Code: ${result.exitCode})`;
      console.error("Write failed:", result);
    }
  } catch (error) {
      const message = (error instanceof Error) ? error.message : String(error);
      statusDiv.textContent = `JavaScript Error: ${message}`;
      console.error("Error calling writeMetadata:", error);
  }
}
```