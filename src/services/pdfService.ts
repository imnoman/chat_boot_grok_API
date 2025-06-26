// import pdf from 'pdf-parse';
// import fs from 'fs/promises';
// import { WeaviateClient } from 'weaviate-ts-client';
// import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

// const textSplitter = new RecursiveCharacterTextSplitter({
//   chunkSize: 1000,
//   chunkOverlap: 200,
// });

// export async function processLocalPDF(filePath: string, weaviateClient: WeaviateClient, className: string) {
//   try {
//     // Verify file exists
//     await fs.access(filePath);
    
//     // Read file
//     const dataBuffer = await fs.readFile(filePath);
    
//     // Extract text
//     const data = await pdf(dataBuffer);
    
//     // Split text
//     const docs = await textSplitter.createDocuments([data.text]);
    
//     // Store in Weaviate
//     for (const [index, doc] of docs.entries()) {
//       try {
//         await weaviateClient.data.creator()
//           .withClassName(className)
//           .withProperties({
//             content: doc.pageContent,
//             source: filePath,
//             chunkIndex: index,
//           })
//           .do();
//       } catch (error) {
//         console.error(`Error storing chunk ${index}:`, error);
//         continue; // Skip to next chunk if one fails
//       }
//     }
    
//     return { success: true, chunks: docs.length };
//   } catch (error) {
//     console.error('Error processing PDF:', error);
//     throw error;
//   }
// }

import pdf from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';
import { WeaviateClient } from 'weaviate-ts-client';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';

const textSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: 1000,
  chunkOverlap: 200,
});

// Track processing time
const startTime = Date.now();

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    console.log(`Retrying (${retries} left)...`);
    await new Promise(res => setTimeout(res, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

export async function processLocalPDF(filePath: string, weaviateClient: WeaviateClient, className: string) {
  try {
    console.log(`Starting processing: ${path.basename(filePath)}`);
    const dataBuffer = await fs.readFile(filePath);
    
    const data = await pdf(dataBuffer, {
      pagerender: (pageData) => {
        const currentPage = pageData.pageNum;
        if (currentPage % 10 === 0) console.log(`Processed ${currentPage} pages...`);
        return (pageData.getTextContent() as Promise<{ items: { str: string }[] }>).then((text: { items: { str: string }[] }) => text.items.map((t: { str: string }) => t.str).join(' '));
      }
    });
    
    const docs = await textSplitter.createDocuments([data.text]);
    console.log(`Created ${docs.length} chunks`);
    
    // Process in smaller batches
    const batchSize = 20; // Reduced from 50
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = weaviateClient.batch.objectsBatcher();
      const batchDocs = docs.slice(i, i + batchSize);
      
      batchDocs.forEach((doc, index) => {
        batch.withObject({
          class: className,
          properties: {
            content: doc.pageContent,
            source: filePath,
            chunkIndex: i + index,
          },
        });
      });
      
      console.log(`Inserting batch ${Math.floor(i / batchSize) + 1}...`);
      await withRetry(() => batch.do());
    }
    
    return { success: true, chunks: docs.length };
  } catch (error) {
    console.error(`Error processing ${path.basename(filePath)}:`, error);
    throw error;
  }
}