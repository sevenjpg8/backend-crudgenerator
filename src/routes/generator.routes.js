import { Router } from 'express';
import multer from 'multer';
import { parseSQL } from '../services/parser.service.js';
import { generateZip } from '../services/generator.service.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No se recibió ningún archivo' });
        }

        const ext = req.file.originalname.split('.').pop().toLowerCase();
        if (ext !== 'sql') {
            return res.status(400).json({ error: 'Solo se aceptan archivos .sql' });
        }

        const sqlText = req.file.buffer.toString('utf-8');
        const entities = parseSQL(sqlText);

        if (Object.keys(entities).length === 0) {
            return res.status(400).json({
                error: 'No se encontraron tablas. Verifica que el archivo contenga sentencias CREATE TABLE.'
            });
        }

        const zipBuffer = await generateZip(entities, sqlText); // ← agregar sqlText

        res.set({
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename="generated-api.zip"'
        });
        res.send(zipBuffer);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

export default router;
