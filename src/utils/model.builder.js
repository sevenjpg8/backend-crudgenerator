/**
 * Mapea tipo SQL ya normalizado al DataType de Sequelize
 */
function toSequelizeType(t) {
    if (!t) return 'DataTypes.STRING';
    const up = t.trim().toUpperCase();

    if (/^ENUM\(/.test(up)) {
        const inner = up.replace(/^ENUM\(/, '').replace(/\)$/, '');
        return `DataTypes.ENUM(${inner})`;
    }
    if (/^DECIMAL\(\d+,\s*\d+\)$/.test(up)) return `DataTypes.${up}`;
    if (/^STRING\(\d+\)$/.test(up)) return `DataTypes.${up}`;

    const map = {
        STRING: 'DataTypes.STRING',
        TEXT: 'DataTypes.TEXT',
        INTEGER: 'DataTypes.INTEGER',
        BIGINT: 'DataTypes.BIGINT',
        FLOAT: 'DataTypes.FLOAT',
        DOUBLE: 'DataTypes.DOUBLE',
        BOOLEAN: 'DataTypes.BOOLEAN',
        DATE: 'DataTypes.DATE',
        DATEONLY: 'DataTypes.DATEONLY',
        TIME: 'DataTypes.TIME',
    };

    return map[up] || 'DataTypes.STRING';
}

/**
 * Genera el archivo Model de Sequelize con soporte de relaciones
 */
export function buildModelFile(name, { fields, relations, createdAt, updatedAt }, dialect = 'mysql') {
    const hasCustomPK = fields.some(f => f.primaryKey);

    // Filtrar createdAt/updatedAt — los maneja Sequelize con timestamps: true
    const filteredFields = fields.filter(
        f => !['createdAt', 'updatedAt', 'createdat', 'updatedat',
            'CreatedAt', 'UpdatedAt', 'created_at', 'updated_at'].includes(f.field)
    );

    const fieldDefs = filteredFields.map(f => {
        const seqType = toSequelizeType(f.type);
        const props = [`        type: ${seqType}`];

        if (f.primaryKey) props.push(`        primaryKey: true`);
        if (f.autoIncrement) props.push(`        autoIncrement: true`);
        if (f.required) props.push(`        allowNull: false`);

        if (f.default !== '' && f.default !== undefined && f.default !== null && f.default !== 'NULL') {
            let dv;
            if (!isNaN(f.default) && f.default !== '') {
                dv = f.default;
            } else if (f.default === 'true' || f.default === 'false') {
                dv = f.default;
            } else {
                dv = `'${f.default}'`;
            }
            props.push(`        defaultValue: ${dv}`);
        }

        if (props.length === 1) return `    ${f.field}: ${seqType}`;
        return `    ${f.field}: {\n${props.join(',\n')}\n    }`;
    }).join(',\n');

    // Asociaciones
    const assocLines = (relations || []).map(r => {
        if (r.type === 'belongsTo') {
            return `    ${name}.belongsTo(models.${r.target}, { foreignKey: '${r.foreignKey}' });`;
        }
        if (r.type === 'hasMany') {
            return `    ${name}.hasMany(models.${r.target}, { foreignKey: '${r.foreignKey}' });`;
        }
        return '';
    }).filter(Boolean);

    const assocBlock = assocLines.length > 0
        ? `\n    static associate(models) {\n${assocLines.join('\n')}\n    }`
        : '';

    const tableName = name;

    // ← PRIMERO calcular useTimestamps
    const useTimestamps = dialect === 'mssql' ? false : (createdAt || updatedAt) ? true : false;

    // ← LUEGO construir timestampOptions según useTimestamps
    let timestampOptions = '';
    if (!useTimestamps) {
        timestampOptions = `\n    timestamps: false,`;
    } else {
        timestampOptions = `\n    timestamps: true,`;
        if (createdAt) timestampOptions += `\n    createdAt: '${createdAt}',`;
        if (!updatedAt) timestampOptions += `\n    updatedAt: false,`;
        if (updatedAt) timestampOptions += `\n    updatedAt: '${updatedAt}',`;
    }


    const modelOptions = hasCustomPK
        ? `{\n    tableName: '${tableName}',${timestampOptions}\n    id: false\n}`
        : `{\n    tableName: '${tableName}',${timestampOptions}\n}`;



    return `import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/connection.js';

class ${name} extends Model {${assocBlock}
}

${name}.init({
${fieldDefs}
}, {
    sequelize,
    ...${modelOptions}
});

export default ${name};
`;
}
