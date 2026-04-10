/**
 * 批量测试 HTML 到 PPTX 转换
 * 测试 pipeline_work/1_html_slides 目录下的所有 HTML 幻灯片
 */

const pptxgen = require('./my_skills/assemble_pptx_file/node_modules/pptxgenjs');
const html2pptx = require('./my_skills/assemble_pptx_file/scripts/html2pptx');
const path = require('path');
const fs = require('fs');

async function testBatchConversion() {
    console.log('=== 开始批量 HTML 到 PPTX 转换测试 ===\n');

    const inputDir = path.join(__dirname, 'pipeline_work/1_html_slides');
    const outputDir = path.join(__dirname, 'pipeline_work/test_output');

    // 创建输出目录
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // 获取所有 HTML 文件（排除 index.html）
    const htmlFiles = fs.readdirSync(inputDir)
        .filter(f => f.endsWith('.html') && f !== 'index.html')
        .sort();

    console.log(`找到 ${htmlFiles.length} 个 HTML 文件:\n`);
    htmlFiles.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');

    // 初始化演示文稿
    const pptx = new pptxgen();

    // 使用自定义布局以匹配 1280px × 720px 的 HTML 尺寸
    // 1280px ÷ 96 DPI = 13.333"
    // 720px ÷ 96 DPI = 7.5"
    pptx.defineLayout({ name: 'CUSTOM_1280x720', width: 13.333, height: 7.5 });
    pptx.layout = 'CUSTOM_1280x720';

    pptx.author = 'PPT Design Studio';
    pptx.title = '批量转换测试 - 1280x720';

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    // 逐个转换 HTML 文件
    for (let i = 0; i < htmlFiles.length; i++) {
        const htmlFile = htmlFiles[i];
        const htmlPath = path.join(inputDir, htmlFile);

        console.log(`[${i + 1}/${htmlFiles.length}] 正在转换: ${htmlFile}`);

        try {
            const result = await html2pptx(htmlPath, pptx, {
                verbose: false  // 减少输出
            });

            console.log(`  ✓ 成功添加幻灯片`);
            if (result.placeholders && result.placeholders.length > 0) {
                console.log(`    - 发现 ${result.placeholders.length} 个占位符`);
            }
            successCount++;

        } catch (error) {
            console.log(`  ✗ 转换失败: ${error.message}`);
            errorCount++;
            errors.push({
                file: htmlFile,
                error: error.message,
                stack: error.stack
            });
        }
        console.log('');
    }

    // 保存演示文稿
    const outputPath = path.join(outputDir, 'batch_test_output.pptx');

    try {
        await pptx.writeFile({ fileName: outputPath });
        const stats = fs.statSync(outputPath);
        console.log(`\n=== 转换完成 ===`);
        console.log(`✓ PPTX 文件已保存: ${outputPath}`);
        console.log(`  文件大小: ${(stats.size / 1024).toFixed(2)} KB`);
    } catch (error) {
        console.log(`\n✗ 保存 PPTX 文件失败: ${error.message}`);
        errorCount++;
    }

    // 输出汇总信息
    console.log(`\n=== 测试结果汇总 ===`);
    console.log(`总计: ${htmlFiles.length} 个文件`);
    console.log(`成功: ${successCount} 个`);
    console.log(`失败: ${errorCount} 个`);

    // 输出错误详情
    if (errors.length > 0) {
        console.log(`\n=== 错误详情 ===`);
        errors.forEach((err, i) => {
            console.log(`\n${i + 1}. ${err.file}`);
            console.log(`   错误: ${err.error}`);
            if (process.env.DEBUG) {
                console.log(`   堆栈:\n${err.stack}`);
            }
        });

        // 保存错误日志
        const errorLogPath = path.join(outputDir, 'conversion_errors.json');
        fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2), 'utf-8');
        console.log(`\n错误日志已保存: ${errorLogPath}`);
    }

    console.log('\n=== 测试完成 ===\n');

    return {
        total: htmlFiles.length,
        success: successCount,
        failed: errorCount,
        errors: errors
    };
}

// 运行测试
testBatchConversion()
    .then(result => {
        if (result.failed > 0) {
            process.exit(1);
        }
    })
    .catch(err => {
        console.error('\n致命错误:', err);
        process.exit(1);
    });
