import OpenAI from 'openai';
import weaviate, { WeaviateClient } from 'weaviate-ts-client';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize OpenAI client for xAI API
const openai = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1' // xAI API endpoint
});

// Initialize Weaviate client
export const weaviateClient = weaviate.client({
  scheme: 'http',
  host: 'localhost:8080'
});

async function initializeWeaviate() {
  try {
    const ready = await weaviateClient.misc.readyChecker().do();
    console.log('Connected to Weaviate');

    const className = 'DocumentChunks';
    const schema = await weaviateClient.schema.getter().do();

    const collectionExists = schema.classes?.some(c => c.class === className);

    if (!collectionExists) {
      await weaviateClient.schema.classCreator().withClass({
        class: className,
        properties: [
          { name: 'content', dataType: ['text'] },
          { name: 'source', dataType: ['text'] },
          { name: 'chunkIndex', dataType: ['int'] }
        ],
        vectorizer: 'text2vec-transformers'
      }).do();
      console.log(`Created ${className} collection`);
    } else {
      console.log(`${className} collection already exists`);
    }
  } catch (error) {
    console.error('Weaviate initialization error:', error);
    throw error;
  }
}

// Initialize on startup
initializeWeaviate().catch(console.error);

export async function processQuestion(question: string): Promise<{ answer: string; references: string[] }> {
  try {
    // Vector search
    console.log('Searching Weaviate for:', question);
    const result = await weaviateClient.graphql.get()
      .withClassName('DocumentChunks')
      .withFields('content source _additional { certainty }')
      .withNearText({ concepts: [question], distance: 0.7 })
      .withLimit(5)
      .do();
    const chunks = result.data.Get?.DocumentChunks || [];
    console.log('Retrieved chunks:', chunks);

    interface DocumentChunk {
      content: string;
      source: string;
      chunkIndex?: number;
      _additional?: {
        certainty?: number;
      };
    }

    // Deduplicate references
    const referencesSet = new Set<string>(chunks.map((chunk: DocumentChunk) => chunk.source));
    const references: string[] = Array.from(referencesSet);

    // Limit context length (e.g., 4000 characters)
    let context = chunks
      .map((chunk: DocumentChunk) => `Source: ${chunk.source}\nContent: ${chunk.content}`)
      .join('\n\n---\n\n');
    if (context.length > 4000) {
      context = context.substring(0, 4000) + '...';
    }

    // Prepare messages for xAI API
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `You are an expert geological assistant. Use the provided context to answer questions. If the context doesn't contain the answer, use your general knowledge to provide a response. If the question is completely unrelated, respond with "I don't have sufficient information to answer this question."

Context:
${context || 'No specific context found.'}

Guidelines:
1. Prioritize information from the context when available.
2. Use general knowledge for questions not covered by the context.
3. Be clear and informative in your response.`
      },
      {
        role: 'user',
        content: question
      }
    ];

    // Get response from xAI API
    try {
      const response = await openai.chat.completions.create({
        model: 'grok-3-mini',
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        stream: false
      });

      const answer = response.choices[0]?.message?.content || 'No response received from the model.';
      return { answer, references };
    } catch (apiError: any) {
      console.error('xAI API error:', {
        message: apiError.message,
        status: apiError.response?.status,
        data: apiError.response?.data
      });
      if (apiError.response?.status === 404 && apiError.response?.data?.error?.code === 'model_not_found') {
        return {
          answer: 'The requested model is unavailable. Please contact the administrator.',
          references
        };
      }
      if (apiError.response?.status === 429) {
        return {
          answer: 'Rate limit exceeded. Please try again later.',
          references
        };
      }
      return {
        answer: 'Failed to get a response from the model. Please try again.',
        references
      };
    }
  } catch (error: any) {
    console.error('Error in processQuestion:', error);
    return {
      answer: 'I encountered an error processing your question. Please try again.',
      references: []
    };
  }
}

// Optional: Function to list available models (for debugging)
export async function listModels() {
  try {
    const models = await openai.models.list();
    console.log('Available models:', models.data);
    return models.data;
  } catch (error) {
    console.error('Error listing models:', error);
    return [];
  }
}