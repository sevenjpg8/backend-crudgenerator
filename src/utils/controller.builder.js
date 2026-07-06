/**
 * Genera el Controller CRUD con include de relaciones en getAll y getById
 */
export function buildControllerFile(name, relations = []) {
    // Modelos relacionados para include
    const belongsToTargets = relations
        .filter(r => r.type === 'belongsTo')
        .map(r => r.target);

    const includeBlock = belongsToTargets.length > 0
        ? `\n        include: [${belongsToTargets.join(', ')}]`  // ← sin la coma al inicio
        : '';

    const imports = belongsToTargets.length > 0
        ? `import ${name} from '../models/${name}.model.js';\n` +
        belongsToTargets.map(t => `import ${t} from '../models/${t}.model.js';`).join('\n')
        : `import ${name} from '../models/${name}.model.js';`;

    return `${imports}

export const getAll = async (req, res) => {
    try {
        const items = await ${name}.findAll({${includeBlock}
        });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getById = async (req, res) => {
    try {
        const item = await ${name}.findByPk(req.params.id${
            includeBlock
                ? `, {\n        include: [${belongsToTargets.join(', ')}]\n        }`
                : ''
        });
        if (!item) return res.status(404).json({ error: '${name} no encontrado' });
        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const create = async (req, res) => {
    try {
        const item = await ${name}.create(req.body);
        res.status(201).json(item);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const update = async (req, res) => {
    try {
        const item = await ${name}.findByPk(req.params.id);
        if (!item) return res.status(404).json({ error: '${name} no encontrado' });
        await item.update(req.body);
        res.json(item);
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const remove = async (req, res) => {
    try {
        const item = await ${name}.findByPk(req.params.id);
        if (!item) return res.status(404).json({ error: '${name} no encontrado' });
        await item.destroy();
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
`;
}
