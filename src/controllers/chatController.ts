
import { processQuestion } from '../services/chatService';

export async function askQuestion(req: any, res: any) {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    // Process question without threadId or userId
    const { answer, references } = await processQuestion(question);

    return res.json({
      answer,
      references
    });
  } catch (error: any) {
    console.error('Error in askQuestion:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message || 'Unknown error'
    });
  }
}