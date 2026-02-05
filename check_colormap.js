
import colormap from 'colormap';

console.log('Keys of colormap function:', Object.keys(colormap));
// Try some known properties if they exist?
// @ts-ignore
if (colormap.colorScale) console.log('Found colorScale');
// @ts-ignore
if (colormap.presets) console.log('Found presets');
