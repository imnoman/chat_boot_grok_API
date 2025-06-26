import express from 'express';
import dotenv from 'dotenv';
import { askQuestion } from './controllers/chatController';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Middleware to validate Bearer token
const validateBearerToken = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  // Validate token against xAI API key
  if (!token || token !== process.env.XAI_API_KEY) {
    res.status(401).json({ error: 'Invalid or missing Bearer token' });
    return;
  }

  next();
};

// Apply token validation to the /ask endpoint
app.post('/ask', validateBearerToken, askQuestion);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});