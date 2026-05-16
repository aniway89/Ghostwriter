#!/usr/bin/env node

/**
 * Ghostwriter V2 — Enterprise Repository Intelligence Platform
 * (IBM BOB Edition)
 *
 * This system implements full repository parsing, dependency graphing,
 * blame-based ownership attribution, and IBM BOB AI reasoning.
 */

import { execa } from "execa";
import simpleGit from "simple-git";
import { glob } from "glob";
import fs from "fs-extra";
import path from "path";
import os from "os";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import readline from "readline";
import { fileURLToPath } from "url";
import { Project, SyntaxKind } from "ts-morph";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i += 2) {
    flags[args[i].replace("--", "")] = args[i + 1];
}

const GITHUB_URL = flags.github || "";
const LOCAL_REPO = flags.repo || "";
const GIT_USER = flags.user || "";
const ROLE = flags.role || "Engineer";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function header(text) {
    console.log("\n" + chalk.hex("#00D4AA").bold(`▸ ${text}`));
}

function subtext(text) {
    console.log(chalk.hex("#8A8A9A")(text));
}

function riskColor(level) {
    if (level === "HIGH") return chalk.hex("#FF4444").bold("HIGH");
    if (level === "MEDIUM") return chalk.hex("#FFAA00").bold("MEDIUM");
    return chalk.hex("#00D4AA").bold("LOW");
}

function banner() {
    console.clear();
    console.log(boxen(
        chalk.hex("#00D4AA").bold("  GhostWriter V2  ") + "\n" +
        chalk.hex("#8A8A9A")("  Enterprise Intelligence powered by IBM BOB\n") +
        chalk.hex("#5A5A7A")("  Structural AST Graphing + Git Blame Forensics"),
        {
            padding: 1,
            borderStyle: "round",
            borderColor: "#00D4AA",
            backgroundColor: "#0A0A0F",
        }
    ));
}

async function prompt(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => {
        rl.question(chalk.hex("#F0EEE8")(question) + " ", answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function longPrompt(question, hint = "") {
    console.log("\n" + chalk.hex("#F0EEE8").bold(question));
    if (hint) console.log(chalk.hex("#8A8A9A")(hint));
    console.log(chalk.hex("#5A5A7A")("(Press Enter twice when done)\n"));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let lines = [];
    let emptyCount = 0;

    return new Promise(resolve => {
        rl.on("line", line => {
            if (line === "") {
                emptyCount++;
                if (emptyCount >= 2) {
                    rl.close();
                    resolve(lines.join("\n").trim());
                }
            } else {
                emptyCount = 0;
                lines.push(line);
                process.stdout.write(chalk.hex("#3A3A5A")("  ✎ "));
            }
        });
    });
}

// ─── IBM BOB API ──────────────────────────────────────────────────────────────

async function bobExplain(filePath) {
    try {
        const result = await execa("bob-shell", ["explain", "--format", "json", filePath], { timeout: 30000 });
        return JSON.parse(result.stdout);
    } catch (err) {
        return {
            summary: `File at ${filePath}`,
            complexity: 5,
            undocumented_sections: ["(bob-shell explanation failed)"],
            key_functions: [],
            risks: [],
        };
    }
}

async function bobReview(filePath) {
    try {
        const result = await execa("bob-shell", ["review", "--format", "json", filePath], { timeout: 30000 });
        return JSON.parse(result.stdout);
    } catch {
        return { risk_level: "MEDIUM", issues: ["(bob-shell review failed)"], recommendations: [] };
    }
}

// ─── GITHUB CLONE HELPER ───────────────────────────────────────────────────────

async function cloneRepo(url) {
    const repoName = url.split("/").pop().replace(".git", "");
    const targetDir = path.join(process.cwd(), ".ghostwriter_tmp", repoName);

    if (fs.existsSync(targetDir)) {
        console.log(chalk.hex("#8A8A9A")(`  Using existing cloned repo: ${targetDir}`));
        return targetDir;
    }

    const spinner = ora({ text: chalk.hex("#8A8A9A")(`Cloning ${url}...`), color: "cyan" }).start();
    try {
        await fs.ensureDir(path.dirname(targetDir));
        await simpleGit().clone(url, targetDir);
        spinner.succeed(chalk.hex("#00D4AA")(`Cloned ${url}`));
        return targetDir;
    } catch (err) {
        spinner.fail(chalk.hex("#FF4444")(`Failed to clone ${url}`));
        throw err;
    }
}

// ─── PHASE 1: REPOSITORY STRUCTURE ENGINE ────────────────────────────────────

class RepoStructureEngine {
    constructor(repoPath) {
        this.repoPath = repoPath;
        this.project = new Project({
            skipAddingFilesFromTsConfig: true,
            compilerOptions: { allowJs: true }
        });
    }

    async parse() {
        const spinner = ora({ text: chalk.hex("#8A8A9A")("Parsing AST & extracting module relationships..."), color: "cyan" }).start();
        
        const allFiles = await glob("**/*.{js,ts,jsx,tsx,py,go,java,cpp,c,h,rb,php,cs,rs}", {
            cwd: this.repoPath,
            ignore: ["node_modules/**", "dist/**", "build/**", "venv/**", ".env/**", "__pycache__/**", "vendor/**", "**/*.d.ts"],
            absolute: true,
            windowsPathsNoEscape: true
        });

        const filesMetadata = {};
        
        // 1. JS/TS files
        const jsFiles = allFiles.filter(f => f.match(/\.(js|ts|jsx|tsx)$/i));
        if (jsFiles.length > 0) {
            this.project.addSourceFilesAtPaths(jsFiles);
            const sourceFiles = this.project.getSourceFiles();
            for (const sf of sourceFiles) {
                const filePath = path.relative(this.repoPath, sf.getFilePath()).replace(/\\/g, '/');
                const imports = sf.getImportDeclarations().map(i => i.getModuleSpecifierValue());
                const exports = sf.getExportDeclarations().map(e => e.getModuleSpecifierValue() || `named export`);
                const functions = sf.getFunctions().map(f => f.getName()).filter(Boolean);
                const classes = sf.getClasses().map(c => c.getName()).filter(Boolean);

                filesMetadata[filePath] = {
                    filePath,
                    imports,
                    exports,
                    functions,
                    classes,
                    loc: sf.getEndLineNumber(),
                    astNodes: sf.getDescendantStatements().length
                };
            }
        }

        // 2. Python & other languages fallback
        const otherFiles = allFiles.filter(f => !f.match(/\.(js|ts|jsx|tsx)$/i));
        for (const f of otherFiles) {
            const filePath = path.relative(this.repoPath, f).replace(/\\/g, '/');
            const content = await fs.readFile(f, "utf-8");
            const lines = content.split('\n');
            
            let imports = [];
            let functions = [];
            let classes = [];

            if (filePath.endsWith('.py')) {
                const importRegex = /^(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm;
                const defRegex = /^def\s+([\w_]+)\s*\(/gm;
                const classRegex = /^class\s+([\w_]+)\s*[\(:]/gm;
                
                let match;
                while ((match = importRegex.exec(content)) !== null) imports.push(match[1] || match[2]);
                while ((match = defRegex.exec(content)) !== null) functions.push(match[1]);
                while ((match = classRegex.exec(content)) !== null) classes.push(match[1]);
            }
            
            filesMetadata[filePath] = {
                filePath,
                imports,
                exports: [],
                functions,
                classes,
                loc: lines.length,
                astNodes: lines.length * 2 // Heuristic multiplier for complexity
            };
        }

        spinner.succeed(chalk.hex("#00D4AA")(`Parsed ${Object.keys(filesMetadata).length} source files across multiple languages.`));
        return filesMetadata;
    }
}

// ─── PHASE 2: DEPENDENCY GRAPH ENGINE ────────────────────────────────────────

class DependencyGraphEngine {
    constructor(filesMetadata) {
        this.files = filesMetadata;
        this.graph = {}; 
        this.reverseGraph = {}; 
    }

    buildGraph() {
        const filePaths = Object.keys(this.files);
        for (const f of filePaths) {
            this.graph[f] = [];
            this.reverseGraph[f] = [];
        }

        for (const f of filePaths) {
            const fileData = this.files[f];
            const dir = path.dirname(f);
            
            for (const imp of fileData.imports) {
                if (imp.startsWith(".")) {
                    // JS relative
                    let resolved = path.join(dir, imp).replace(/\\/g, '/');
                    for (const ext of ["", ".js", ".ts", ".jsx", ".tsx", "/index.js", "/index.ts"]) {
                        if (this.files[resolved + ext]) {
                            const target = resolved + ext;
                            if (!this.graph[f].includes(target)) this.graph[f].push(target);
                            if (!this.reverseGraph[target].includes(f)) this.reverseGraph[target].push(f);
                            break;
                        }
                    }
                } else if (f.endsWith('.py')) {
                    // Python absolute/relative mapping logic
                    const pyPath = imp.replace(/\./g, '/') + ".py";
                    const matchedFile = filePaths.find(fp => fp.endsWith(pyPath));
                    if (matchedFile) {
                        if (!this.graph[f].includes(matchedFile)) this.graph[f].push(matchedFile);
                        if (!this.reverseGraph[matchedFile].includes(f)) this.reverseGraph[matchedFile].push(f);
                    }
                }
            }
        }
    }

    computeCentrality() {
        const spinner = ora({ text: chalk.hex("#8A8A9A")("Computing architectural centrality (Blast Radius)..."), color: "cyan" }).start();
        const centrality = {};
        for (const f of Object.keys(this.files)) {
            const blastRadius = this._calculateBlastRadius(f);
            centrality[f] = {
                inDegree: this.reverseGraph[f]?.length || 0,
                outDegree: this.graph[f]?.length || 0,
                blastRadius: blastRadius,
                score: (this.reverseGraph[f]?.length || 0) * 1.5 + blastRadius * 2
            };
        }
        spinner.succeed(chalk.hex("#00D4AA")("Dependency graph & Blast Radius computed."));
        return centrality;
    }

    _calculateBlastRadius(startFile) {
        let visited = new Set([startFile]);
        let queue = [startFile];
        let count = 0;
        
        while (queue.length > 0) {
            let current = queue.shift();
            for (let dep of (this.reverseGraph[current] || [])) {
                if (!visited.has(dep)) {
                    visited.add(dep);
                    queue.push(dep);
                    count++;
                }
            }
        }
        return count;
    }
}

// ─── PHASE 3: OWNERSHIP ENGINE ───────────────────────────────────────────────

class OwnershipEngine {
    constructor(repoPath) {
        this.repoPath = repoPath;
        this.git = simpleGit(repoPath);
    }

    async computeOwnership(files, targetAuthor) {
        const spinner = ora({ text: chalk.hex("#8A8A9A")(`Calculating surviving LOC & churn for @${targetAuthor} via git blame...`), color: "cyan" }).start();
        const ownership = {};
        
        // Only process a subset if there are hundreds of files to save time, or process all.
        const fileKeys = Object.keys(files);
        
        for (const file of fileKeys) {
            try {
                const blame = await this.git.raw(['blame', '--line-porcelain', file]);
                let totalLines = 0;
                let targetAuthorLines = 0;
                
                const lines = blame.split('\n');
                for (let line of lines) {
                    if (line.startsWith('author ')) {
                        totalLines++;
                        if (line.toLowerCase().includes(targetAuthor.toLowerCase())) {
                            targetAuthorLines++;
                        }
                    }
                }

                const log = await this.git.raw(['log', '--oneline', '--', file]);
                const churn = log.trim() ? log.trim().split('\n').length : 0;

                const survivalRatio = totalLines > 0 ? targetAuthorLines / totalLines : 0;
                const ownershipConfidence = survivalRatio * Math.max(0.1, (1 - (churn / 100)));

                ownership[file] = {
                    totalLines,
                    survivingLines: targetAuthorLines,
                    churn,
                    survivalRatio,
                    ownershipConfidence
                };
            } catch (err) {
                ownership[file] = { totalLines: 0, survivingLines: 0, churn: 0, survivalRatio: 0, ownershipConfidence: 0 };
            }
        }
        spinner.succeed(chalk.hex("#00D4AA")(`Ownership attribution (Git Blame Forensics) completed.`));
        return ownership;
    }
}

// ─── PHASE 4: RISK ENGINE ────────────────────────────────────────────────────

class RiskEngine {
    computeRisk(filesMetadata, centrality, ownership) {
        const spinner = ora({ text: chalk.hex("#8A8A9A")("Scoring repository risk metrics..."), color: "cyan" }).start();
        const riskScores = [];

        for (const file of Object.keys(filesMetadata)) {
            const meta = filesMetadata[file];
            const cent = centrality[file];
            const own = ownership[file];

            let riskScore = 0;
            
            // Blast radius heavily impacts risk
            riskScore += Math.min(cent.score / 10, 4.0);
            
            // Complexity (AST Nodes)
            riskScore += Math.min(meta.astNodes / 100, 3.0);
            
            // Single Point of Failure (Ownership concentration)
            if (own.survivalRatio > 0.5) {
                riskScore += 3.0 * own.survivalRatio;
            }

            // Only care about files where the departing engineer actually owns code
            if (own.survivingLines > 0) {
                riskScores.push({
                    file,
                    riskScore: Math.min(riskScore, 10.0),
                    meta,
                    centrality: cent,
                    ownership: own
                });
            }
        }

        riskScores.sort((a, b) => b.riskScore - a.riskScore);
        spinner.succeed(chalk.hex("#00D4AA")(`Risk orchestration complete.`));
        return riskScores;
    }
}

// ─── PHASE 5: IBM BOB REASONING LAYER ────────────────────────────────────────

class BobReasoningEngine {
    async scanAndGenerateQuestions(topRiskFiles) {
        header("IBM BOB Codebase Scan");
        console.log(subtext(`  Scanning top ${topRiskFiles.length} critical files...`));

        const results = [];
        for (const item of topRiskFiles) {
            const absPath = path.resolve(item.file);
            const spinner = ora({ text: chalk.hex("#5A5A7A")(`  bob-shell → ${item.file}`), color: "cyan", indent: 2 }).start();

            const [explain, review] = await Promise.all([
                bobExplain(absPath),
                bobReview(absPath),
            ]);

            const riskLevel = review.risk_level || (explain.complexity >= 8 ? "HIGH" : "MEDIUM");

            // Dynamically construct questions based on BOB outputs + AST Graph Data
            const questions = [];
            
            // 1. Undocumented sections + Blast Radius
            if (explain.undocumented_sections && explain.undocumented_sections.length > 0) {
                questions.push(`IBM BOB flagged an undocumented section: "${explain.undocumented_sections[0]}". Structural analysis shows this file has a Blast Radius of ${item.centrality.blastRadius} downstream modules. What specifically breaks in those dependents if someone misinterprets this undocumented logic?`);
            }
            
            // 2. High Complexity + Ownership
            if (explain.complexity >= 7) {
                questions.push(`IBM BOB scored this file at a complexity of ${explain.complexity}/10. Git blame forensics show you own ${Math.round(item.ownership.survivalRatio * 100)}% of the surviving code (${item.ownership.survivingLines} LOC). What is the non-obvious logic here that a new engineer would most likely fail to understand?`);
            }

            // 3. Known Issues
            if (review.issues && review.issues.length > 0) {
                questions.push(`IBM BOB flagged this issue: "${review.issues[0]}". Was this a deliberate architectural trade-off, technical debt, or something temporary? Explain the context.`);
            }

            // Fallback if bob finds nothing specific
            if (questions.length === 0) {
                questions.push(`This module is highly central to the architecture (Blast Radius: ${item.centrality.blastRadius}). Walk me through the critical assumptions you made when building this.`);
            }

            spinner.succeed(
                chalk.hex("#2A2A3A")(`  ${item.file} `) +
                riskColor(riskLevel) +
                (explain.undocumented_sections?.length ? chalk.hex("#FFAA00")(` ⚠ ${explain.undocumented_sections.length} undocumented`) : "")
            );

            results.push({
                file: item.file,
                risk_level: riskLevel,
                summary: explain.summary,
                complexity: explain.complexity,
                issues: review.issues,
                blastRadius: item.centrality.blastRadius,
                survivingLoc: item.ownership.survivingLines,
                generatedQuestion: questions[0] // take the most relevant question
            });
        }

        return results;
    }
}

// ─── PHASE 6: KNOWLEDGE SYNTHESIS ENGINE ─────────────────────────────────────

class KnowledgeSynthesisEngine {
    async synthesizeDocs(qaLog, outDir, repoName) {
        const spinner = ora({ text: chalk.hex("#8A8A9A")("Synthesizing Institutional Knowledge into Playbook..."), color: "cyan" }).start();
        
        await fs.ensureDir(outDir);
        const today = new Date().toISOString().slice(0, 10);
        
        let md = `# Enterprise Onboarding Playbook: ${repoName}
*Generated by GhostWriter V2 — Structural Intelligence + IBM BOB*
*Date: ${today}*

> **WARNING:** This document replaces irreplaceable institutional knowledge. The modules listed below have been identified via static analysis as high-risk architectural bottlenecks.

---

## Critical Modules Overview

`;

        for (const item of qaLog) {
            md += `### \`${item.file}\`
**Risk Level:** ${item.risk_level} | **Blast Radius:** ${item.blastRadius} dependents | **Owned LOC:** ${item.survivingLoc}
**IBM BOB Summary:** ${item.summary || "No summary available."}

**Known Issues (IBM BOB):**
${item.issues && item.issues.length ? item.issues.map(i => `- ${i}`).join('\n') : "- None"}

`;
        }

        md += `---

## Knowledge Extraction Records (ADRs)

`;
        
        let adrNum = 1;
        for (const item of qaLog) {
            if (!item.answer || item.answer.length < 10) continue;
            
            md += `### ADR-${String(adrNum).padStart(3, "0")}: Context for \`${item.file}\`

**Context (AI Generated Question):**
${item.generatedQuestion}

**Decision & Context (Engineer's Response):**
> ${item.answer.replace(/\n/g, '\n> ')}

---

`;
            adrNum++;
        }

        const docPath = path.join(outDir, "Ghostwriter-Playbook.md");
        await fs.writeFile(docPath, md, 'utf-8');
        spinner.succeed(chalk.hex("#00D4AA")(`Synthesized docs saved to ${docPath}`));
    }
}

// ─── MAIN ORCHESTRATOR ────────────────────────────────────────────────────────

async function main() {
    banner();

    let repoPath = path.resolve(process.cwd());
    
    if (GITHUB_URL) {
        repoPath = await cloneRepo(GITHUB_URL);
    } else if (LOCAL_REPO) {
        repoPath = path.resolve(LOCAL_REPO);
    }
    let username = GIT_USER;
    
    if (!username) {
        username = await prompt("Departing Engineer's Git Author Name:");
    }

    if (!fs.existsSync(path.join(repoPath, ".git"))) {
        console.log(chalk.hex("#FF4444")(`  ✖ Not a git repository: ${repoPath}`));
        process.exit(1);
    }

    console.log();

    // 1. Repo Structure
    header("Phase 1: AST Parsing");
    const structEngine = new RepoStructureEngine(repoPath);
    const filesMetadata = await structEngine.parse();

    if (Object.keys(filesMetadata).length === 0) {
        console.log(chalk.hex("#FF4444")("  ✖ No JS/TS files parsed."));
        process.exit(1);
    }

    // 2. Dependency Graph
    header("Phase 2: Architectural Centrality");
    const graphEngine = new DependencyGraphEngine(filesMetadata);
    graphEngine.buildGraph();
    const centrality = graphEngine.computeCentrality();

    // 3. Ownership Forensics
    header("Phase 3: Ownership Forensics");
    const ownershipEngine = new OwnershipEngine(repoPath);
    const ownership = await ownershipEngine.computeOwnership(filesMetadata, username);

    // 4. Risk Engine
    header("Phase 4: Risk Orchestration");
    const riskEngine = new RiskEngine();
    const riskScores = riskEngine.computeRisk(filesMetadata, centrality, ownership);

    if (riskScores.length === 0) {
        console.log(chalk.hex("#FFAA00")(`\n  ⚠ No significant surviving code found for @${username}.`));
        process.exit(0);
    }

    const topRisk = riskScores.slice(0, 8); // Top 8 high risk files for interview

    // 5. AI Reasoning Layer (IBM BOB)
    const bobEngine = new BobReasoningEngine();
    const bobResults = await bobEngine.scanAndGenerateQuestions(topRisk);

    // Q&A Loop
    header("Phase 5: Contextual Knowledge Extraction");
    console.log(chalk.hex("#8A8A9A")("  IBM BOB has generated contextual questions combining AST data and structural risk.\n"));
    
    const qaLog = [];
    for (let i = 0; i < bobResults.length; i++) {
        const item = bobResults[i];
        console.clear();
        banner();
        
        const filled = Math.round(((i) / bobResults.length) * 30);
        const bar = chalk.hex("#00D4AA")("█".repeat(filled)) + chalk.hex("#2A2A3A")("░".repeat(30 - filled));
        console.log(`\n  ${bar}  ${chalk.hex("#8A8A9A")(`Question ${i + 1} of ${bobResults.length}`)}\n`);

        console.log("  " + riskColor(item.risk_level) + "  " + chalk.hex("#00D4AA")(item.file));
        console.log(chalk.hex("#8A8A9A")(`  Blast Radius: ${item.blastRadius} | Owner LOC: ${item.survivingLoc} | Complexity: ${item.complexity}/10\n`));

        console.log(boxen(
            chalk.hex("#F0EEE8").bold(item.generatedQuestion),
            { padding: { top: 0, bottom: 0, left: 2, right: 2 }, borderColor: "#2A2A3A", borderStyle: "round" }
        ));

        const answer = await longPrompt("", "Share everything — context, edge cases, what would trip up a new engineer.");
        
        qaLog.push({ ...item, answer });
        
        console.log("\n  " + chalk.hex("#00D4AA")("✔") + chalk.hex("#8A8A9A")(" Captured. Moving to next...\n"));
        await new Promise(r => setTimeout(r, 800));
    }

    // 6. Knowledge Synthesis
    console.clear();
    banner();
    header("Phase 6: Playbook Synthesis");
    
    const synthesisEngine = new KnowledgeSynthesisEngine();
    const outDir = path.join(process.cwd(), ".ghostwriter");
    await synthesisEngine.synthesizeDocs(qaLog, outDir, path.basename(repoPath));

    console.log("\n" + boxen(
        chalk.hex("#00D4AA").bold("✔ Knowledge Extraction Complete\n\n") +
        chalk.hex("#F0EEE8")(`  ${qaLog.length} critical modules analyzed\n`) +
        chalk.hex("#F0EEE8")(`  Playbook generated with Structural + IBM BOB Data\n\n`) +
        chalk.hex("#8A8A9A")(`  Output: ${outDir}`),
        { padding: 1, borderColor: "#00D4AA", borderStyle: "round" }
    ));
}

main().catch(err => {
    console.error(chalk.hex("#FF4444")("\n  Fatal error: " + err.message));
    process.exit(1);
});
