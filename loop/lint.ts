// The lint for decision modules. The plan asks for a lint that rejects
// hostnames, selectors and per-example constants, so a decision cannot be tuned
// to one site, one element or one logged click. It also keeps the module a
// small pure function.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import ts from 'typescript';

export interface Problem {
  file: string;
  line: number;
  message: string;
}

export const LIMITS = {
  /** A decision is a handful of rules. More than this is a lookup table. */
  maxLines: 400,
  /** Numbers get a few significant digits. More is a constant fitted to one example. */
  maxSignificantDigits: 3,
  maxNumbers: 60,
  /** An array of numbers longer than this is a table. */
  maxNumberArray: 8,
  maxStringLength: 24,
  /** Word lists, such as irreversible labels, may be long. Everything else may not. */
  maxStrings: 160,
} as const;

/** Modules a decision may import, besides its own files. */
const ALLOWED_IMPORTS = new Set(['../core/geometry', '../core/types']);

/** Names that reach outside the function: I/O, time, randomness and the global object. */
const FORBIDDEN_NAMES = new Set([
  'process',
  'globalThis',
  'global',
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'chrome',
  'eval',
  'Function',
  'require',
  'module',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Date',
  'performance',
  'crypto',
  'setTimeout',
  'setInterval',
  'queueMicrotask',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'console',
  'Buffer',
  'Deno',
  'Bun',
  'Reflect',
  'Proxy',
  'Intl',
  'WebAssembly',
  'Atomics',
  'SharedArrayBuffer',
]);

/** The members of Math a decision may use. Each gives the same answer for the same input. */
const MATH_MEMBERS = new Set([
  'abs',
  'min',
  'max',
  'hypot',
  'sqrt',
  'cbrt',
  'floor',
  'ceil',
  'round',
  'trunc',
  'sign',
  'pow',
  'exp',
  'log',
  'log2',
  'log10',
  'sin',
  'cos',
  'tan',
  'atan',
  'atan2',
  'PI',
  'E',
]);

/** Property names that lead from any value to code the lint cannot see. */
const HIDDEN_DOORS = new Set(['constructor', '__proto__', 'prototype']);

/** A plain lowercase word or phrase, such as a label keyword or a reason code. */
const PLAIN_WORDS = /^[a-z][a-z -]*$/;

/** Text that looks like a hostname, a URL, a file path or a CSS selector. */
const HOSTNAME = /[a-z0-9-]\.[a-z]{2,}/i;
const SELECTOR = /[#.][a-z_][\w-]*|\[[^\]]*[=~|^$*]|\w\s*>\s*\w|::?[a-z-]+\(|:\/\/|[@/]/i;

function significantDigits(text: string): number {
  const digits = text
    .replace(/_/g, '')
    .replace(/e[+-]?\d+$/i, '')
    .replace('.', '');
  return digits.replace(/^0+/, '').replace(/0+$/, '').length;
}

/** The files of a decision module: every .ts file under its folder, tests left out. */
export function decisionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.test.ts'))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** Links in a decision folder. A link can point at a file the lint never reads. */
function decisionLinks(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isSymbolicLink())
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

function lintFile(
  file: string,
  name: string,
  source: string,
  own: Set<string>,
  problems: Problem[],
): void {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const report = (node: ts.Node, message: string) => {
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
    problems.push({ file: name, line: line + 1, message });
  };
  let numbers = 0;
  let strings = 0;

  const checkText = (node: ts.Node, text: string, what: string) => {
    if (HOSTNAME.test(text)) report(node, `${what} looks like a hostname or a file name.`);
    else if (SELECTOR.test(text)) report(node, `${what} looks like a selector, a URL or a path.`);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const from = node.moduleSpecifier;
      if (from && ts.isStringLiteral(from)) {
        const path = from.text.replace(/\.ts$/, '');
        // An import of its own has to land on a file that is linted and kept with
        // the decision. A test file is neither, and a link can lead anywhere.
        const isOwn =
          path.startsWith('./') &&
          !path.includes('..') &&
          own.has(resolve(dirname(file), `${path}.ts`));
        if (!isOwn && !ALLOWED_IMPORTS.has(path)) {
          report(
            node,
            `Import of "${from.text}". A decision may import only its own files, ../core/geometry and ../core/types.`,
          );
        }
      }
      // The module path is not a string constant of the decision. Skip it.
      node.forEachChild((child) => {
        if (child !== from) visit(child);
      });
      return;
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      report(node, 'Dynamic import.');
    }
    if (ts.isMetaProperty(node)) report(node, 'import.meta.');
    // A module-level variable that can be assigned again is a place to keep a count of the calls.
    if (
      ts.isVariableStatement(node) &&
      node.parent === tree &&
      !(node.declarationList.flags & ts.NodeFlags.Const)
    ) {
      report(
        node,
        'A module-level let or var. A decision keeps nothing from one click to the next.',
      );
    }
    if (ts.isIdentifier(node) && FORBIDDEN_NAMES.has(node.text)) {
      const parent = node.parent;
      const isMember =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node);
      if (!isMember)
        report(
          node,
          `Use of "${node.text}". A decision is a pure function of the click's features.`,
        );
    }
    // Only the arithmetic of Math. Math.random is the obvious way out, and an
    // inherited member such as Math.valueOf hands back the whole object.
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Math' &&
      !MATH_MEMBERS.has(node.name.text)
    ) {
      report(
        node,
        `Math.${node.name.text}. A decision must give the same answer for the same click.`,
      );
    }
    // Math is only ever written as Math.<name>. Any other use, such as
    // Math['random'], an alias or a destructuring, could reach random unseen.
    if (ts.isIdentifier(node) && node.text === 'Math') {
      const parent = node.parent;
      const isObject = ts.isPropertyAccessExpression(parent) && parent.expression === node;
      const isName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node);
      if (!isObject && !isName) {
        report(
          node,
          'Math used other than as Math.<name>. A decision must give the same answer for the same click.',
        );
      }
    }
    // The constructor of any function builds new code from a string, which reaches everything.
    const key = ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
    if (key !== null && HIDDEN_DOORS.has(key)) {
      report(node, `Use of "${key}". A decision is a pure function of the click's features.`);
    }
    if (ts.isBindingElement(node)) {
      const picked = node.propertyName ?? node.name;
      if (
        (ts.isIdentifier(picked) || ts.isStringLiteralLike(picked)) &&
        HIDDEN_DOORS.has(picked.text)
      ) {
        report(
          node,
          `Use of "${picked.text}". A decision is a pure function of the click's features.`,
        );
      }
    }

    if (ts.isNumericLiteral(node)) {
      numbers++;
      if (significantDigits(node.getText()) > LIMITS.maxSignificantDigits) {
        report(
          node,
          `The number ${node.getText()} has more than ${LIMITS.maxSignificantDigits} significant digits. That reads as a constant fitted to one example.`,
        );
      }
    }
    if (ts.isBigIntLiteral(node)) report(node, 'BigInt literal.');
    if (ts.isArrayLiteralExpression(node)) {
      const numeric = node.elements.filter(
        (e) =>
          ts.isNumericLiteral(e) ||
          (ts.isPrefixUnaryExpression(e) && ts.isNumericLiteral(e.operand)),
      ).length;
      if (numeric > LIMITS.maxNumberArray) {
        report(node, `An array of ${numeric} numbers. That reads as a lookup table.`);
      }
    }

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      strings++;
      const text = node.text;
      if (text.length > LIMITS.maxStringLength) {
        report(
          node,
          `A string of ${text.length} characters. Strings in a decision are short keywords.`,
        );
      } else if (text !== '' && !PLAIN_WORDS.test(text)) {
        checkText(node, text, 'This string');
        if (/[A-Z]/.test(text) || /\d/.test(text)) {
          report(
            node,
            `The string "${text}" has capitals or digits. Compare labels in lower case against plain keywords.`,
          );
        }
      }
    }
    if (ts.isTemplateExpression(node)) {
      const chunks = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      for (const chunk of chunks) {
        checkText(node, chunk, 'This template');
        if (/[A-Za-z]{2,}/.test(chunk.replace(/\\[bBdDsSwW]/g, ''))) {
          report(node, 'A template with words in it. Put keywords in a plain string list.');
        }
      }
    }
    if (ts.isRegularExpressionLiteral(node)) {
      const body = node.text.slice(1, node.text.lastIndexOf('/'));
      checkText(node, body, 'This pattern');
      if (/[A-Za-z]{4,}/.test(body.replace(/\\[bBdDsSwW]/g, ''))) {
        report(node, 'A pattern with words in it. Put keywords in a plain string list.');
      }
    }
    node.forEachChild(visit);
  };
  visit(tree);

  if (numbers > LIMITS.maxNumbers) {
    problems.push({
      file: name,
      line: 1,
      message: `${numbers} numbers. A decision gets at most ${LIMITS.maxNumbers}.`,
    });
  }
  if (strings > LIMITS.maxStrings) {
    problems.push({
      file: name,
      line: 1,
      message: `${strings} strings. A decision gets at most ${LIMITS.maxStrings}.`,
    });
  }
}

/** Type-checks the decision against the repo's own core types. */
function typeCheck(files: string[], dir: string, coreDir: string, problems: Problem[]): void {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    lib: ['lib.es2023.d.ts'],
  };
  const host = ts.createCompilerHost(options);
  // "../core/x" always means the repo's core, whatever sits beside the decision.
  host.resolveModuleNames = (names, containing) =>
    names.map((name) => {
      const core = /^\.\.\/core\/([\w-]+)(\.ts)?$/.exec(name);
      if (core)
        return { resolvedFileName: join(coreDir, `${core[1]}.ts`), extension: ts.Extension.Ts };
      return ts.resolveModuleName(name, containing, options, host).resolvedModule;
    });
  const program = ts.createProgram(files, options, host);
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const file = diagnostic.file;
    if (file && !file.fileName.startsWith(dir)) continue;
    const line =
      file && diagnostic.start !== undefined
        ? file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : 1;
    problems.push({
      file: file ? relative(dir, file.fileName) : '',
      line,
      message: `Type error: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    });
  }
  // A key worked out at run time could spell "constructor" or "random" where
  // the checks above cannot see it. A key is allowed when its type says it is
  // a number, or one of a known set of strings that are all harmless.
  const checker = program.getTypeChecker();
  const isSafeKey = (type: ts.Type): boolean => {
    if (type.isUnion()) return type.types.every(isSafeKey);
    if (type.flags & ts.TypeFlags.NumberLike) return true;
    return type.isStringLiteral() && !HIDDEN_DOORS.has(type.value) && type.value !== 'random';
  };
  for (const file of files) {
    const tree = program.getSourceFile(file);
    if (!tree) continue;
    const visit = (node: ts.Node): void => {
      const key = ts.isElementAccessExpression(node)
        ? node.argumentExpression
        : ts.isComputedPropertyName(node)
          ? node.expression
          : null;
      if (key && !isSafeKey(checker.getTypeAtLocation(key))) {
        problems.push({
          file: relative(dir, file),
          line: tree.getLineAndCharacterOfPosition(key.getStart()).line + 1,
          message:
            'A computed key that is not a number or a known harmless word. It could reach code the lint cannot see.',
        });
      }
      node.forEachChild(visit);
    };
    visit(tree);
  }

  const index = program.getSourceFile(join(dir, 'index.ts'));
  // A file with no import and no export is not a module, and has no symbol.
  const module = index && checker.getSymbolAtLocation(index);
  const exportsDecide = module
    ? checker.getExportsOfModule(module).some((symbol) => symbol.name === 'decide')
    : false;
  if (!exportsDecide) {
    problems.push({
      file: 'index.ts',
      line: 1,
      message: 'index.ts must export a function named decide.',
    });
  }
}

/** Lints the decision module in a folder. `coreDir` is the repo's src/core. */
export function lintDecision(dir: string, coreDir: string): Problem[] {
  const problems: Problem[] = [];
  // A folder that is a link could hold anything from anywhere.
  if (lstatSync(dir).isSymbolicLink()) {
    return [
      { file: '', line: 1, message: 'The decision folder is a link. It has to be a folder.' },
    ];
  }
  const files = decisionFiles(dir);
  if (!files.includes(join(dir, 'index.ts'))) {
    return [{ file: 'index.ts', line: 1, message: 'The decision folder has no index.ts.' }];
  }
  for (const link of decisionLinks(dir)) {
    problems.push({
      file: relative(dir, link),
      line: 1,
      message: 'A link. Every file of a decision has to be a plain file the lint can read.',
    });
  }
  let lines = 0;
  const own = new Set(files);
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    lines += source.split('\n').length;
    lintFile(file, relative(dir, file), source, own, problems);
  }
  if (lines > LIMITS.maxLines) {
    problems.push({
      file: '',
      line: 1,
      message: `${lines} lines. A decision gets at most ${LIMITS.maxLines}.`,
    });
  }
  if (problems.length === 0) typeCheck(files, dir, coreDir, problems);
  return problems;
}
