import fs from 'fs';
const path = 'src/utils/generators.js';
let content = fs.readFileSync(path, 'utf8');

// Remove redundant last points in Triangle and Square
content = content.replace(/points\.push\(\{\s*\.\.\.corners\[corners\.length\s*-\s*1\],\s*r,\s*g,\s*b,\s*lastPoint:\s*true\s*\}\);/g, '// Redundant point removed');

fs.writeFileSync(path, content);
console.log('Fixed generators.js');
