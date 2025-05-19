# @uswriting/exiftool

[ExifTool](https://exiftool.org) (13.11) powered by WebAssembly to extract and write metadata from/to files in browsers and Node.js environments using [zeroperl](https://github.com/uswriting/zeroperl).

## Installation

```
npm install @uswriting/exiftool
```

## Description

This package provides a WebAssembly-based implementation of ExifTool that works in both browser and Node.js environments. It leverages [zeroperl](https://github.com/uswriting/zeroperl) to execute ExifTool without requiring any native binaries or system dependencies.

## Usage

### Parsing Metadata

#### Basic Usage

```typescript
import { parseMetadata } from '@uswriting/exiftool';

// Browser usage with File API
document.querySelector('input[type="file"]').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  const result = await parseMetadata(file);
  
  if (result.success) {
    console.log(result.data);
  } else {
    console.error('Error:', result.error);
  }
});
```

#### Extracting Specific Metadata

```typescript
import { parseMetadata } from '@uswriting/exiftool';

const result = await parseMetadata(file, {
  args: ['-Author', '-CreateDate', '-Make', '-Model']
});

if (result.success) {
  console.log(result.data);
}
```

### JSON Output

```typescript
import { parseMetadata } from '@uswriting/exiftool';

const result = await parseMetadata(file, {
  args: ['-json', '-n'],
  transform: (data) => JSON.parse(data)
});

if (result.success) {
  // Typed access to properties
  console.log(result.data); // { ... }
}
```

### Writing Metadata

#### Basic Usage

This example demonstrates writing basic XMP tags to a selected file using a string array for tags.

```typescript
import { writeMetadata, ExifToolWriteOptions } from '@uswriting/exiftool';

// 'selectedFile' is a File object obtained from user input.

if (selectedFile) {
  const tagsToWrite: string[] = [
    "-XMP-dc:Description=My test image",
    "-XMP-photoshop:Credit=Photographer Name",
    "-XMP-dc:Subject=Nature, Landscape"
  ];

  const options: ExifToolWriteOptions = {
    tags: tagsToWrite
    // For more advanced options like 'configFile' or 'extraArgs',
    // refer to the API Reference for ExifToolWriteOptions.
  };

  const result = await writeMetadata(selectedFile, options);

  if (result.success) {
    // Modified file contents
    console.log(result.data);  // { ... }
  }
}
```

## Important Notes

- In browser environments, pass the `File` object directly from file inputs. Do not convert it to an ArrayBuffer or Uint8Array.
- The `writeMetadata` function returns a *new* `Uint8Array` containing the modified file data. The original file object is not changed.
- This package uses asynchronous web APIs for file processing which allows handling files over 2GB without loading them entirely into memory.
- ExifTool is executed entirely within the browser or Node.js environment - no server requests are made for metadata extraction.

## API Reference

### parseMetadata()

```typescript
async function parseMetadata<TReturn = string>(
  file: Binaryfile | File,
  options: ExifToolOptions<TReturn> = {}
): Promise<ExifToolOutput<TReturn>>
```

#### Parameters

- `file`: Either a browser `File` object or a `Binaryfile` object with `name` and `data` properties.
- `options`: Configuration options for the metadata extraction.

#### `ExifToolOptions`

```typescript
interface ExifToolOptions<TReturn> {
  // Additional command-line arguments to pass to ExifTool
  args?: string[];
  
  // Custom fetch implementation for loading the WASM module
  fetch?: (...args: any[]) => Promise<Response>;
  
  // Transform the raw ExifTool output into a different format
  transform?: (data: string) => TReturn;
}
```

#### Return Value (`ExifToolOutput`)

Returns a Promise that resolves to an `ExifToolOutput` object:

```typescript
type ExifToolOutput<TOutput> =
  | {
      success: true;
      data: TOutput;
      error: string;
      exitCode: 0;
    }
  | {
      success: false;
      data: undefined;
      error: string;
      exitCode: number | undefined;
    };
```

### `writeMetadata()`

```typescript
async function writeMetadata(
  file: Binaryfile | File,
  options: ExifToolWriteOptions
): Promise<ExifToolWriteResult>
```

#### Parameters

  - `file`: Either a browser `File` object or a `Binaryfile` object (`{ name: string, data: Uint8Array | Blob }`) representing the file to modify.
  - `options`: Configuration options for writing metadata.

#### `ExifToolWriteOptions`

```typescript
// Defines possible values for a tag when using TagsObject.
type TagValue = string | number | boolean | (string | number | boolean)[];

// Represents tags as a JavaScript object for writing metadata.
type TagsObject = Record<string, TagValue>;

interface ExifToolWriteOptions {
  // Tags to write. Can be an array of ExifTool arguments (e.g., `["-Comment=Test"]`)
  // or a `TagsObject` (e.g., `{ "Comment": "Test", "IPTC:Keywords": ["one", "two"] }`).
  tags: string[] | TagsObject;

  // Optional: Custom ExifTool config file for defining custom tags.
  // Provide as { name: string, data: Uint8Array }.
  configFile?: {
    name: string;
    data: Uint8Array;
  };

  // Custom fetch implementation for loading the WASM module.
  fetch?: (...args: any[]) => Promise<Response>;

  // Additional command-line arguments for ExifTool (e.g., `-m` for ignore minor errors).
  // Avoid input/output filenames or tag assignments here.
  extraArgs?: string[];
}
```

#### Return Value (`ExifToolWriteResult`)

Returns a Promise that resolves to an `ExifToolWriteResult` object:

```typescript
type ExifToolWriteResult =
  | {
      success: true;
      data: Uint8Array;
      warnings: string;
      exitCode: 0;
    }
  | {
      success: false;
      data: undefined;
      error: string;
      exitCode: number | undefined;
    };
```

## License

Apache License, Version 2.0
