const { compile } = require("./parse");
const { nameCheck } = require("./naming");
const { typeCheck } = require("./typecheck");
const {
  test,
  assert,
  assertEqual,
  summarize: reportTestFailures,
} = require("../test");

test("Type-check empty program", () => {
  const statements = compile("");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "Empty program should have no type errors");
});

test("Type-check simple numeric declaration", () => {
  const statements = compile("const x = 5;");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected");
});

test("Type-check variable reference with same type", () => {
  const statements = compile("const x = 5; const y = x;");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected");
});

test("Type-check string declaration and concatenation", () => {
  const statements = compile('const x = "hello"; const y = "world"; const z = x + y;');
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for string concatenation");
});

test("Type-check numeric operations", () => {
  const statements = compile("const x = 5; const y = 10; const z = x + y;");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for numeric addition");
});

test("Detect type mismatch in binary operation", () => {
  const statements = compile('const x = 5; const y = "hello"; const z = x + y;');
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 1, "Should report type mismatch");
  assert(
    result.errors[0].message.includes("Type mismatch"),
    "Error message should mention type mismatch",
  );
});

test("Type-check multiplication operation", () => {
  const statements = compile("const x = 5; const y = 10; const z = x * y;");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for numeric multiplication");
});

test("Detect type mismatch in multiplication", () => {
  const statements = compile('const x = 5; const y = "hello"; const z = x * y;');
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 1, "Should report type mismatch");
  assert(
    result.errors[0].message.includes("Type mismatch"),
    "Error message should mention type mismatch",
  );
});

test("Type-check ternary expression with matching types", () => {
  const statements = compile("const x = true; const y = x ? 1 : 2;");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for ternary with matching types");
});

test("Detect type mismatch in ternary condition", () => {
  const statements = compile("const x = 5; const y = x ? 1 : 2;");
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 1, "Should report type mismatch in ternary condition");
  assert(
    result.errors[0].message.includes("condition"),
    "Error message should mention condition must be Boolean",
  );
});

test("Detect type mismatch in ternary branches", () => {
  const statements = compile('const x = true; const y = x ? 1 : "hello";');
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 1, "Should report type mismatch in ternary branches");
  assert(
    result.errors[0].message.includes("branches"),
    "Error message should mention branches must have same type",
  );
});

test("Type-check array literals with consistent types", () => {
  const statements = compile(
    "const x = 1; const y = 2; const arr = [x, y, 3];",
  );
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for array with consistent types");
});

test("Detect type mismatch in array literals", () => {
  const statements = compile(
    'const x = 1; const y = "hello"; const arr = [x, y, 3];',
  );
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 1, "Should report type mismatch in array elements");
  assert(
    result.errors[0].message.includes("array"),
    "Error message should mention array element type consistency",
  );
});

test("Type-check array access with numeric index", () => {
  const statements = compile(
    "const arr = [1, 2, 3]; const x = arr[0];",
  );
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for array access with numeric index");
});

test("Detect non-numeric array index", () => {
  const statements = compile(
    'const arr = [1, 2, 3]; const i = "hello"; const x = arr[i];',
  );
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 1, "Should report non-numeric array index");
  assert(
    result.errors[0].message.includes("index"),
    "Error message should mention array index must be a Number",
  );
});

test("Type-check function with compatible argument types", () => {
  const statements = compile(`
    const add = (x) => { return x + 1; };
    const result = add(5);
  `);
  const result = typeCheck(statements);

  assertEqual(result.errors.length, 0, "No type errors expected for function with compatible arg");
});

reportTestFailures();
