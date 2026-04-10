
const { html2pptx } = require('./my_skills/assemble_pptx_file/scripts/html2pptx.js');
const path = require('path');

// Mock PptxGenJS to capture calls
const mockPptx = {
    presLayout: { width: 12192000, height: 6858000 }, // 16:9
    ShapeType: { rect: 'rect', roundRect: 'roundRect' },
    slide: {
        addText: (text, options) => {
            console.log(`\n[Element Text]: "${text}"`);
            if (options.shadow) {
                console.log('  [Shadow]:', JSON.stringify(options.shadow));
            } else {
                console.log('  [Shadow]: NONE');
            }
        },
        addShape: (type, options) => {
            console.log(`\n[Element Shape]: ${type}`);
            if (options.shadow) {
                console.log('  [Shadow]:', JSON.stringify(options.shadow));
            } else {
                console.log('  [Shadow]: NONE');
            }
        },
        addImage: () => { }
    },
    addSlide: function () { return this.slide; }
};

(async () => {
    try {
        const htmlPath = path.resolve('verify_shadow.html');
        console.log(`Processing: ${htmlPath}`);
        await html2pptx(htmlPath, mockPptx);
    } catch (err) {
        console.error(err);
    }
})();
