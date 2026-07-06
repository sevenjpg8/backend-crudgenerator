import JSZip from 'jszip';
import { buildModelFile } from '../utils/model.builder.js';
import { buildControllerFile } from '../utils/controller.builder.js';
import { buildRouteFile } from '../utils/route.builder.js';

/**
 * Ordena las tablas respetando dependencias de FK (topological sort)
 * para que el sync no falle por orden de creación
 */
function sortByDependencies(entities) {
    const names = Object.keys(entities);
    const sorted = [];
    const visited = new Set();

    function visit(name) {
        if (visited.has(name)) return;
        visited.add(name);
        const relations = entities[name]?.relations || [];
        relations
            .filter(r => r.type === 'belongsTo')
            .forEach(r => visit(r.target));
        sorted.push(name);
    }

    names.forEach(visit);
    return sorted;
}

function detectDialect(sqlText) {
    if (/SERIAL|BIGSERIAL|\$\d+|::[\w]+/i.test(sqlText)) return 'postgres';
    if (/NVARCHAR|UNIQUEIDENTIFIER|DATETIME2|IDENTITY\s*\(/i.test(sqlText)) return 'mssql';
    return 'mysql';
}

export async function generateZip(entities, sqlText) {
    const dialect = detectDialect(sqlText);
    const zip = new JSZip();
    const names = sortByDependencies(entities);

    
    // .env.example — puerto y usuario por defecto según dialecto
    const dbPort = dialect === 'postgres' ? 5432
        : dialect === 'mssql' ? 1433
            : 3306;

    const dbUser = dialect === 'postgres' ? 'postgres'
        : dialect === 'mssql' ? 'sa'
            : 'root';

    // package.json — driver según dialecto
    const dbDriver = dialect === 'postgres' ? { pg: '^8.11.0', 'pg-hstore': '^2.3.4' }
        : dialect === 'mssql' ? { tedious: '^18.0.0' }
            : { mysql2: '^3.6.0' };

    zip.file('package.json', JSON.stringify({
        name: 'generated-api',
        version: '1.0.0',
        type: 'module',
        description: 'API REST generada automáticamente con Express + Sequelize',
        main: 'app.js',
        scripts: {
            start: 'node app.js',
            dev: 'nodemon app.js',
            sync: 'node sync.js'
        },
        dependencies: {
            express: '^4.18.2',
            cors: '^2.8.5',
            sequelize: '^6.35.0',
            dotenv: '^16.3.1',
            ...dbDriver
        },
        devDependencies: {
            nodemon: '^3.0.1'
        }
    }, null, 2));

    // ── config/connection.js ──────────────────────────────────────────────────
    zip.file('config/connection.js', `import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';
dotenv.config();

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || ${dbPort},
        dialect: process.env.DB_DIALECT || '${dialect}',
        logging: false,
        ${dialect === 'mssql' ? `dialectOptions: {
            options: {
                useUTC: false,
                dateFirst: 1,
                trustServerCertificate: true
            }
        },` : ''}
    }
);

export default sequelize;
`);

    // ── sync.js — importa modelos en orden correcto (FK primero) ─────────────
    zip.file('sync.js', `import sequelize from './config/connection.js';
${names.map(n => `import './models/${n}.model.js';`).join('\n')}

const syncDatabase = async () => {
    try {
        await sequelize.authenticate();
        console.log('✔ Conexión a la base de datos establecida.');
        await sequelize.sync();
        console.log('✔ Tablas sincronizadas correctamente.');
        process.exit(0);
    } catch (err) {
        console.error('✘ Error al sincronizar:', err.message);
        process.exit(1);
    }
};

syncDatabase();
`);

    // ── app.js ────────────────────────────────────────────────────────────────
    const routeImports = names.map(n =>
        `import ${n.toLowerCase()}Router from './routes/${n}.routes.js';`
    ).join('\n');

    const routeUses = names.map(n => {
        const routeName = n.toLowerCase(); // ← sin agregar 's'
        return `app.use('/api/${routeName}', ${n.toLowerCase()}Router);`;
    }).join('\n');

    zip.file('app.js', `import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
dotenv.config();

// Modelos
${names.map(n => `import ${n} from './models/${n}.model.js';`).join('\n')}

// Rutas
${names.map(n => `import ${n.toLowerCase()}Router from './routes/${n}.routes.js';`).join('\n')}

const app = express();
app.use(cors());
app.use(express.json());

// Inicializar asociaciones
const models = { ${names.join(', ')} };
${names.map(n => `if (${n}.associate) ${n}.associate(models);`).join('\n')}

// Registrar rutas
${routeUses}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(\`Server running on http://localhost:\${PORT}\`));
export default app;
`);

    zip.file('.env.example', `PORT=3000
        DB_HOST=localhost
        DB_PORT=${dbPort}
        DB_NAME=mi_base_de_datos
        DB_USER=${dbUser}
        DB_PASS=
        DB_DIALECT=${dialect}
        `);

    // ── .gitignore ────────────────────────────────────────────────────────────
    zip.file('.gitignore', `node_modules/\n.env\n`);

    // ── README.md ─────────────────────────────────────────────────────────────
    const endpoints = names.map(n => {
        const base = `/api/${n.toLowerCase()}`; // ← sin agregar 's'
        return `### ${n}\n| Método | Endpoint |\n|--------|----------|\n| GET | ${base} |\n| GET | ${base}/:id |\n| POST | ${base} |\n| PUT | ${base}/:id |\n| DELETE | ${base}/:id |`;
    }).join('\n\n');

    zip.file('README.md', `# Generated API

API REST generada automáticamente con **Node.js + Express + Sequelize**.

## Requisito previo — Base de datos

Antes de correr el proyecto, asegúrate de que:
1. La base de datos ya esté creada en tu servidor
2. Las tablas ya estén creadas ejecutando tu script SQL

> El comando \`sync\` **no modifica ni elimina** tablas existentes. Solo verifica la conexión.

## Instalación

\`\`\`bash
npm install
\`\`\`

## Configuración

\`\`\`bash
cp .env.example .env
# Edita .env con tus credenciales de base de datos
\`\`\`

## Sincronizar y verificar conexión

\`\`\`bash
npm run sync
\`\`\`

## Correr el servidor

\`\`\`bash
npm run dev
\`\`\`

## Recomendación para columnas de auditoría

Si tus tablas tienen columnas de fecha de creación o modificación, usa estos defaults en tu script SQL para que se llenen automáticamente sin necesidad de mandarlos desde el código:

\`\`\`sql
CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
\`\`\`

## Endpoints

${endpoints}
`);

    // ── Modelos, Controllers, Routes ──────────────────────────────────────────
    names.forEach(name => {
        const entity = entities[name];
        zip.file(`models/${name}.model.js`, buildModelFile(name, entity, dialect));
        zip.file(`controllers/${name}.controller.js`, buildControllerFile(name, entity.relations));
        zip.file(`routes/${name}.routes.js`, buildRouteFile(name));
    });

    return zip.generateAsync({ type: 'nodebuffer' });
}
