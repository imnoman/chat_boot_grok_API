// import { weaviateClient } from './services/chatService';
// import { processLocalPDF } from './services/pdfService';
// import fs from 'fs/promises';
// import path from 'path';

// async function processPDFs(inputPath: string) {
//   try {
//     // Check if path exists
//     await fs.access(inputPath);

//     // Get stats to determine if it's a file or directory
//     const stats = await fs.stat(inputPath);

//     if (stats.isFile()) {
//       // Process single file
//       if (path.extname(inputPath).toLowerCase() !== '.pdf') {
//         console.log(`Skipping non-PDF file: ${inputPath}`);
//         return;
//       }
//       console.log(`Processing PDF: ${inputPath}`);
//       await processLocalPDF(inputPath, weaviateClient, 'DocumentChunks');
//     } else if (stats.isDirectory()) {
//       // Process all PDFs in directory
//       const files = await fs.readdir(inputPath);
//       for (const file of files) {
//         const fullPath = path.join(inputPath, file);
//         if (path.extname(fullPath).toLowerCase() === '.pdf') {
//           console.log(`Processing PDF: ${fullPath}`);
//           await processLocalPDF(fullPath, weaviateClient, 'DocumentChunks');
//         }
//       }
//     }

//     console.log('PDF processing completed successfully');
//   } catch (error) {
//     console.error('Error processing PDFs:', error);
//     process.exit(1);
//   }
// }

// // Get path from command line argument
// const inputPath = process.argv[2];
// if (!inputPath) {
//   console.error('Usage: ts-node processPDFs.ts <pdf-file-or-directory>');
//   process.exit(1);
// }

// processPDFs(inputPath);

// import { weaviateClient } from './services/chatService';
// import { processLocalPDF } from './services/pdfService';
// import fs from 'fs/promises';
// import path from 'path';
// import async from 'async';

// async function processPDFs(inputPath: string) {
//   try {
//     console.log('Starting PDF processing pipeline...');
    
//     await fs.access(inputPath);
//     const stats = await fs.stat(inputPath);

//     if (stats.isFile()) {
//       if (path.extname(inputPath).toLowerCase() !== '.pdf') {
//         console.log(`Skipping non-PDF file: ${inputPath}`);
//         return;
//       }
//       await processLocalPDF(inputPath, weaviateClient, 'DocumentChunks');
//     } else if (stats.isDirectory()) {
//       const files = await fs.readdir(inputPath);
//       const pdfFiles = files.filter(file => 
//         path.extname(file).toLowerCase() === '.pdf'
//       );

//       if (pdfFiles.length === 0) {
//         console.log('No PDF files found in directory');
//         return;
//       }

//       console.log(`Found ${pdfFiles.length} PDF files to process`);
      
//       // Process PDFs with concurrency control
//       await async.eachLimit(pdfFiles, 2, async (file) => { // Reduced to 2 concurrent
//         const fullPath = path.join(inputPath, file);
//         await processLocalPDF(fullPath, weaviateClient, 'DocumentChunks');
//       });
//     }

//     console.log('PDF processing completed successfully');
//   } catch (error) {
//     console.error('Error processing PDFs:', error);
//     process.exit(1);
//   }
// }

// const inputPath = process.argv[2];
// if (!inputPath) {
//   console.error('Usage: ts-node processPDFs.ts <pdf-file-or-directory>');
//   process.exit(1);
// }

// processPDFs(inputPath);
import { weaviateClient } from './services/chatService';
import { processLocalPDF } from './services/pdfService';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';

// Configuration
const MAX_CONCURRENT_PDFS = 1; // Process one PDF at a time for stability
const LOG_PREFIX = '[PDF Processor]';

interface ProcessingResult {
  filename: string;
  success: boolean;
  chunks?: number;
  error?: string;
  duration?: number;
}

async function checkWeaviateHealth(): Promise<boolean> {
  try {
    await weaviateClient.misc.readyChecker().do();
    console.log(`${LOG_PREFIX} Weaviate connection healthy`);
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} Weaviate health check failed:`, error);
    return false;
  }
}

async function processSinglePDF(filePath: string): Promise<ProcessingResult> {
  const startTime = performance.now();
  const filename = path.basename(filePath);
  const result: ProcessingResult = { filename, success: false };

  try {
    console.log(`${LOG_PREFIX} Starting processing: ${filename}`);
    const { chunks } = await processLocalPDF(filePath, weaviateClient, 'DocumentChunks');
    result.success = true;
    result.chunks = chunks;
    console.log(`${LOG_PREFIX} Successfully processed ${filename} (${chunks} chunks)`);
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${LOG_PREFIX} Failed to process ${filename}:`, result.error);
  } finally {
    result.duration = (performance.now() - startTime) / 1000;
    console.log(`${LOG_PREFIX} Processing time for ${filename}: ${result.duration.toFixed(2)}s`);
  }

  return result;
}

async function processPDFs(inputPath: string): Promise<void> {
  console.log(`${LOG_PREFIX} Starting PDF processing pipeline`);
  const globalStart = performance.now();

  try {
    // 1. Validate Weaviate connection
    if (!await checkWeaviateHealth()) {
      throw new Error('Weaviate not available');
    }

    // 2. Validate input path
    await fs.access(inputPath);
    const stats = await fs.stat(inputPath);

    let results: ProcessingResult[] = [];

    if (stats.isFile()) {
      // Single file processing
      if (path.extname(inputPath).toLowerCase() !== '.pdf') {
        console.log(`${LOG_PREFIX} Skipping non-PDF file: ${inputPath}`);
        return;
      }
      results.push(await processSinglePDF(inputPath));
    } else if (stats.isDirectory()) {
      // Directory processing
      const files = await fs.readdir(inputPath);
      const pdfFiles = files
        .filter(file => path.extname(file).toLowerCase() === '.pdf')
        .map(file => path.join(inputPath, file));

      if (pdfFiles.length === 0) {
        console.log(`${LOG_PREFIX} No PDF files found in directory`);
        return;
      }

      console.log(`${LOG_PREFIX} Found ${pdfFiles.length} PDF files to process`);

      // Process files sequentially with controlled concurrency
      for (let i = 0; i < pdfFiles.length; i++) {
        results.push(await processSinglePDF(pdfFiles[i]));
        console.log(`${LOG_PREFIX} Progress: ${i + 1}/${pdfFiles.length} files processed`);
      }
    }

    // Generate summary report
    const successful = results.filter(r => r.success).length;
    const totalChunks = results.reduce((sum, r) => sum + (r.chunks || 0), 0);
    const totalTime = (performance.now() - globalStart) / 1000;

    console.log('\n=== Processing Summary ===');
    console.log(`PDFs processed successfully: ${successful}/${results.length}`);
    console.log(`Total chunks created: ${totalChunks}`);
    console.log(`Total processing time: ${totalTime.toFixed(2)} seconds`);
    console.log('=========================');

    if (successful < results.length) {
      const failedFiles = results.filter(r => !r.success).map(r => r.filename);
      console.warn(`${LOG_PREFIX} Warning: Failed to process ${failedFiles.length} files:`, failedFiles);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${LOG_PREFIX} Fatal error in processing pipeline:`, errorMessage);
    process.exit(1);
  }
}

// Main execution
(async () => {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(`${LOG_PREFIX} Usage: ts-node processPDFs.ts <pdf-file-or-directory>`);
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} Input path: ${inputPath}`);
  await processPDFs(inputPath);
  process.exit(0);
})();