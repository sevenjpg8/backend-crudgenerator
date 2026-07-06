import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import generatorRouter from './routes/generator.routes.js';

const app = express();

app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
}));

app.use(express.json());
app.use('/api/generate', generatorRouter);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API Generator backend running on http://localhost:${PORT}`));

export default app;
