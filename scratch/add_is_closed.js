import fs from 'fs';
const path = 'src/utils/generators.js';
let content = fs.readFileSync(path, 'utf8');

// Add isClosed: true to closed generators
const closedGenerators = ['generateCircle', 'generateSquare', 'generateTriangle', 'generateStar', 'generatePolygon'];
closedGenerators.forEach(gen => {
    const regex = new RegExp(`export function ${gen}\\(params\\) \\{[\\s\\S]*?return \\{ points: applyRenderingStyle\\(points, params\\) \\};`, 'g');
    content = content.replace(regex, (match) => {
        return match.replace('return { points: applyRenderingStyle(points, params) };', 'return { points: applyRenderingStyle(points, params), isClosed: true };');
    });
});

fs.writeFileSync(path, content);
console.log('Added isClosed flag to generators.js');
