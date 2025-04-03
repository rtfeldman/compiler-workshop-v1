/**
 * Type Inference Module
 *
 * This module implements type inference based on a modified version of the Hindley-Milner algorithm,
 * which is the foundation of type systems in many functional languages.
 *
 * Features:
 * - Automatic type inference without explicit type annotations
 * - Polymorphic type support (functions that work on multiple types)
 * - Multiple parameter functions with proper type checking
 * - Type checking for operations and expressions
 * - Detailed type error reporting
 *
 * Note: Return statement position validation is handled by the validate.js module.
 *
 * How it works:
 * 1. Each expression is assigned a type variable initially
 * 2. As we analyze the code, we gather constraints about what these type variables must be
 * 3. We use unification to solve these constraints, determining concrete types
 * 4. If constraints are inconsistent, we report type errors
 *
 * The algorithm is based on the work of Roger Hindley and Robin Milner, who independently
 * developed similar type systems in the late 1960s and early 1970s, but has been modified
 * to support multiple parameter functions directly rather than through currying.
 */

/**
 * Types supported by our type system
 *
 * Our language has the following basic types:
 * - Number: Integer numbers (e.g., 1, 2, 3)
 * - Float: Floating-point numbers (e.g., 1.5, 2.0)
 * - Bool: Boolean values (true, false)
 * - String: Text strings (e.g., "hello")
 * - Function: Functions from one type to another
 * - Unknown: Used during inference when type is not yet determined
 */
const Types = {
  Number: "Number",
  Float: "Float",
  Bool: "Bool",
  String: "String",
  Function: "Function",
  Unknown: "Unknown",
  Void: "Void",
  Array: "Array",
};

// Global variables to replace state object
let errors = [];
let currentScope = {};
let nonGeneric = new Set();
let nextTypeVarId = 0;

/**
 * Create a new function type
 *
 * @param {object[]} paramTypes - Array of parameter types
 * @param {object} returnType - Type of the return value
 * @returns {object} - A function type object
 */
function createFunctionType(paramTypes, returnType) {
  return { kind: "FunctionType", paramTypes, returnType };
}

/**
 * Create a new array type
 *
 * @param {object} elementType - Type of the array elements
 * @returns {object} - An array type object
 */
function createArrayType(elementType) {
  return { kind: "ArrayType", elementType };
}

/**
 * Create a new primitive type like String, Bool, Number.
 *
 * @param {string} type - The name of the type
 * @returns {object} - A concrete type object
 */
function primitive(type) {
  return { kind: "PrimitiveType", type };
}

/**
 * Compress a type by following the chain of instances
 *
 * If this type variable has been unified with another type,
 * follow the chain to get the most specific type.
 *
 * @param {object} type - The type to compress
 * @returns {object} - The most specific type
 */
function compress(type) {
  if (type.kind === "TypeVariable" && type.symlink) {
    // Recursively compress the symlink path
    type.symlink = compress(type.symlink);
    return type.symlink;
  }

  return type;
}

/**
 * Check if a type variable appears within another type
 *
 * This is used to prevent infinite types like t0 = Array<t0>,
 * which would lead to infinite types.
 *
 * @param {object} typeVar - The type variable to check
 * @param {object} type - The type to check inside
 * @returns {boolean} - Whether this variable occurs in the given type
 */
function occursIn(typeVar, type) {
  type = compress(type);

  // Direct self-reference, e.g. `a = a`
  if (type === typeVar) {
    return true;
  }

  // Check inside function types recursively
  if (type.kind === "FunctionType") {
    return (
      type.paramTypes.some(paramType => occursIn(typeVar, paramType)) ||
      occursIn(typeVar, type.returnType)
    );
  }

  // Check inside array types recursively
  if (type.kind === "ArrayType") {
    return occursIn(typeVar, type.elementType);
  }

  return false;
}

/**
 * Return a string representation of a type.
 *
 * @param {object} type - The type to convert to string
 * @returns {string} - A readable representation of the type
 */
function typeToString(type) {
  type = compress(type);

  if (type.kind === "TypeVariable") {
    return type.name;
  } else if (type.kind === "PrimitiveType") {
    return type.type;
  } else if (type.kind === "FunctionType") {
    // Handle multiple parameters
    const paramTypeStrs = type.paramTypes.map(paramType => {
      // Parenthesize parameter type if it's a function to avoid ambiguity
      return compress(paramType).kind === "FunctionType"
        ? `(${typeToString(paramType)})`
        : typeToString(paramType);
    });

    // Format as (Type1, Type2, ...) -> ReturnType
    return `(${paramTypeStrs.join(", ")}) -> ${typeToString(type.returnType)}`;
  } else if (type.kind === "ArrayType") {
    return `Array<${typeToString(type.elementType)}>`;
  }

  return "UnknownType";
}

/**
 * Report a type error
 *
 * This records a type error with location information to help
 * the user identify and fix the problem.
 *
 * @param {string} message - Error message
 * @param {object} node - parse tree node where the error occurred
 */
function reportError(message, node) {
  let location = "unknown position";

  // Try to get position information from the node
  if (node.position !== undefined) {
    location = `position ${node.position}`;
  } else if (node.id && node.id.position !== undefined) {
    location = `position ${node.id.position}`;
  }

  // Add the error to our list
  errors.push({
    message: `${message} at ${location}`,
    node,
  });
}

/**
 * This is used when we need a new type variable, for example
 * when inferring the type of a function parameter.
 *
 * @param {string|null} name - Optional name for the type variable
 * @param {string|null} context - Optional context information about where this type variable came from
 * @returns {object} - A new type variable
 */
function newTypeVar(name = null, context = null) {
  const id = nextTypeVarId;
  nextTypeVarId = nextTypeVarId + 1;
  const typeVar = {
    kind: "TypeVariable",
    id,
    name: name || `t${id}`,
    symlink: null,
  };

  // Context information kept for documentation but events removed
  // let contextInfo = "Anonymous variable";
  // if (name) {
  //   contextInfo = `Named variable ${name}`;
  // }
  // if (context) {
  //   contextInfo = context;
  // }

  return typeVar;
}

/**
 * Create a fresh instance of a type, where the shape of the new type is the same
 * as the old one, but all the type variables have been replaced with fresh ones.
 *
 * This is used for polymorphic types, where each use of a type
 * should be independent. For example, if a function has type
 * (a -> a), each call to the function should use fresh type variables.
 *
 * @param {object} type - The type to create a fresh instance of
 * @param {Map} mappings - Map to track variables (defaults to new map)
 * @returns {object} - A fresh instance of the type
 */
function freshInstance(type, mappings = new Map()) {
  type = compress(type);

  if (type.kind === "TypeVariable") {
    mappings.set(type, newTypeVar(null, `Fresh instance of ${type.name}`));
    return mappings.get(type);
  } else if (type.kind === "FunctionType") {
    // For function types, recursively freshen parameter and return types
    const freshParamTypes = type.paramTypes.map(paramType =>
      freshInstance(paramType, mappings)
    );
    return createFunctionType(
      freshParamTypes,
      freshInstance(type.returnType, mappings),
    );
  } else if (type.kind === "ArrayType") {
    // For array types, recursively freshen element type
    return createArrayType(freshInstance(type.elementType, mappings));
  } else {
    // Concrete types don't need to be freshened
    return type;
  }
}

/**
 * Get the type of a variable from the current environment
 *
 * This looks up a variable name in the current scope and returns its type.
 * If the variable is not found, a fresh type variable is created.
 *
 * @param {string} name - The variable name to look up
 * @returns {object} - The type of the variable
 */
function getType(name) {
  // Look up the variable in the current scope
  const type = currentScope[name];

  // If the type is in the non-generic set, return it as is
  // (this prevents overgeneralization in certain contexts)
  if (nonGeneric.has(type)) {
    return type;
  }

  // Otherwise, create a fresh instance to ensure proper polymorphism
  return freshInstance(type);
}

/**
 * Unify two types, making them equal
 *
 * This is the heart of the Hindley-Milner algorithm. Unification
 * takes two types and tries to make them equal by:
 * 1. If one is a type variable, set it to the other type
 * 2. If both are function types, unify parameter and return types
 * 3. If both are array types, unify their element types
 * 4. If both are concrete types, check if they're the same
 *
 * @param {object} t1 - First type to unify
 * @param {object} t2 - Second type to unify
 * @param {object} node - parse tree node for error reporting
 */
function unify(t1, t2, node) {
  // First, prune both types to get their most specific form
  t1 = compress(t1);
  t2 = compress(t2);

  // Case 1: First type is a variable
  if (t1.kind === "TypeVariable") {
    // If they're not already the same variable
    if (t1 !== t2) {
      // Check for infinite types (which are not allowed)
      if (occursIn(t1, t2)) {
        reportError(
          `Infinite unification: cannot unify ${typeToString(t1)} with ${typeToString(t2)}`,
          node,
        );

        return;
      }

      // Set the type variable to point to the other type
      t1.symlink = t2;
    }
  }
  // Case 2: Both are function types
  else if (t1.kind === "FunctionType" && t2.kind === "FunctionType") {
    // Check if the number of parameters match
    if (t1.paramTypes.length !== t2.paramTypes.length) {
      reportError(
        `Function parameter count mismatch: ${typeToString(t1)} vs ${typeToString(t2)}`,
        node
      );
      return;
    }

    // Recursively unify each parameter type
    for (let i = 0; i < t1.paramTypes.length; i++) {
      unify(t1.paramTypes[i], t2.paramTypes[i], node);
    }

    // Unify the return types
    unify(t1.returnType, t2.returnType, node);
  }
  // Case 3: Both are array types
  else if (t1.kind === "ArrayType" && t2.kind === "ArrayType") {


    // Recursively unify element types
    unify(t1.elementType, t2.elementType, node);
  }
  // Case 4: Both are concrete types
  else if (t1.kind === "PrimitiveType" && t2.kind === "PrimitiveType") {
    // Check if they're the same type
    if (t1.type !== t2.type) {
      reportError(
        `Type mismatch: ${typeToString(t1)} is not compatible with ${typeToString(t2)}`,
        node,
      );
      return;
    }
  }
  // Case 5: Second type is a variable (swap and try again)
  else if (t2.kind === "TypeVariable") {
    unify(t2, t1, node);
  }
  // Case 6: Types are incompatible
  else {
    reportError(
      `Cannot unify ${typeToString(t1)} with ${typeToString(t2)}`,
      node,
    );
    return;
  }
}

/**
 * Enter a new type scope
 *
 * This is used when entering a new lexical scope like a function.
 * A new scope inherits from its parent but can define new variables
 * or shadow existing ones.
 */
function pushScope() {
  const outerScope = currentScope;
  // Create a new scope with the current scope as prototype
  const newScope = Object.create(outerScope);

  currentScope = newScope;
}

/**
 * Analyze a parse tree node and infer its type
 *
 * This is the main type inference function that dispatches to
 * specialized functions based on the node type.
 *
 * @param {object} node - parse tree node to analyze
 * @returns {object} - Inferred type
 */
function infer(node) {
  // Dispatch based on node type
  switch (node.type) {
    // Program structure
    case "Program":
      return inferTypeProgram(node);

    // Literals
    case "NumericLiteral":
      return inferTypeNumericLiteral(node);

    case "StringLiteral":
      return inferTypeStringLiteral(node);

    case "BooleanLiteral":
      return inferTypeBooleanLiteral(node);

    case "ArrayLiteral":
      return inferTypeArrayLiteral(node);

    case "ExpressionStatement":
      return inferTypeExpressionStatement(node);

    case "Identifier":
      return inferTypeIdentifier(node);

    case "BinaryExpression":
      return inferTypeBinaryExpression(node);

    case "ConditionalExpression":
      return inferTernary(node);

    case "ArrowFunctionExpression":
      return inferTypeFunction(node);

    case "CallExpression":
      return inferTypeCallExpression(node);

    case "MemberExpression":
      return inferTypeMemberExpression(node);

    case "ConstDeclaration":
      return inferTypeConstDeclaration(node);

    case "ReturnStatement":
      return inferTypeReturnStatement(node);

    default:
      reportError(`Unknown node type: ${node.type}`, node);
      return newTypeVar(null, `Unknown node type: ${node.type}`);
  }
}

/**
 * Infer type for a function call expression
 *
 * @param {object} node - Call expression node
 * @returns {object} - Inferred type
 */
function inferTypeCallExpression(node) {
  // Infer the type of the function being called
  let fnType = infer(node.callee);
  fnType = compress(fnType);  // Make sure we have the most specific type

  // Handle the function call and its arguments
  if (fnType.kind !== "FunctionType") {
    // If it's not yet resolved to a function, create a fresh function type
    if (fnType.kind === "TypeVariable") {
      // Create a return type variable
      const returnType = newTypeVar(null, `Return type for call to ${node.callee.type === 'Identifier' ? node.callee.name : 'expression'}`);

      // For each argument, infer its type and create the function type
      const argTypes = [];
      for (const arg of node.arguments) {
        const argType = infer(arg);
        argTypes.push(argType);
      }

      // Create function type with all argument types
      const funcType = createFunctionType(argTypes, returnType);
      unify(fnType, funcType, node);
      return returnType;
    } else {
      reportError("Called value is not a function", node);
      return newTypeVar();
    }
  }

  // Check if the argument count matches the function's parameter count
  if (node.arguments.length !== fnType.paramTypes.length) {
    reportError(
      `Expected ${fnType.paramTypes.length} arguments but got ${node.arguments.length}`,
      node
    );
    return fnType.returnType; // Still return the return type to avoid cascading errors
  }

  // Infer types for all arguments and unify with function parameter types
  for (let i = 0; i < node.arguments.length; i++) {
    const arg = node.arguments[i];
    const argType = infer(arg);
    unify(fnType.paramTypes[i], argType, arg);
  }

  // Return the function's return type
  return fnType.returnType;
}

/**
 * Infer types for a program
 *
 * @param {object} node - Program node
 * @returns {object} - Inferred type
 */
function inferTypeProgram(node) {
  let resultType = primitive(Types.Unknown);

  for (const statement of node.body) {
    resultType = infer(statement);

    // Add type annotations to the parse tree
    statement.inferredType = resultType;
  }

  return resultType;
}

/**
 * Infer type for a numeric literal
 *
 * @param {object} node - Numeric literal node
 * @returns {object} - Inferred type
 */
function inferTypeNumericLiteral(node) {
  // Check if the value has a decimal point
  if (Number.isInteger(node.value)) {
    return primitive(Types.Number);
  } else {
    return primitive(Types.Float);
  }
}

/**
 * Infer type for a string literal
 *
 * @param {object} node - String literal node
 * @returns {object} - Inferred type
 */
function inferTypeStringLiteral(node) {
  return primitive(Types.String);
}

/**
 * Infer type for a boolean literal
 *
 * @param {object} node - Boolean literal node
 * @returns {object} - Inferred type
 */
function inferTypeBooleanLiteral(node) {
  return primitive(Types.Bool);
}

/**
 * Infer type for an identifier
 *
 * @param {object} node - Identifier node
 * @returns {object} - Inferred type
 */
function inferTypeIdentifier(node) {
  return getType(node.name);
}

/**
 * Infer type for a binary expression
 *
 * @param {object} node - Binary expression node
 * @returns {object} - Inferred type
 */
function inferTypeBinaryExpression(node) {
  let leftType = infer(node.left);
  let rightType = infer(node.right);

  switch (node.operator) {
    case "+": {
      // Check if both operands are strings for concatenation
      const leftIsString =
        compress(leftType).kind === "PrimitiveType" &&
        compress(leftType).type === Types.String;
      const rightIsString =
        compress(rightType).kind === "PrimitiveType" &&
        compress(rightType).type === Types.String;

      if (leftIsString && rightIsString) {
        // String concatenation - both operands must be strings
        return primitive(Types.String);
      } else if (leftIsString || rightIsString) {
        // One operand is a string but not both - this is an error
        reportError(
          `Cannot concatenate string with non-string value`,
          node
        );
        return primitive(Types.String);
      } else {
        // Numeric addition
        // Check if both operands can be numeric
        const numericTypes = [Types.Number, Types.Float];

        let leftIsNumeric = compress(leftType).kind === "PrimitiveType" &&
                           numericTypes.includes(compress(leftType).type);

        let rightIsNumeric = compress(rightType).kind === "PrimitiveType" &&
                            numericTypes.includes(compress(rightType).type);

        // If both are numeric or can be numeric (type variables)
        if ((leftIsNumeric || compress(leftType).kind === "TypeVariable") &&
            (rightIsNumeric || compress(rightType).kind === "TypeVariable")) {

          // For simplicity in this implementation, we prefer Number over Float
          const resultType = primitive(Types.Number);

          // Ensure both operands are numeric
          unify(leftType, resultType, node.left);
          unify(rightType, resultType, node.right);

          return resultType;
        } else {
          reportError(
            `The '+' operator requires either numeric operands or string operands`,
            node,
          );
          return newTypeVar();
        }
      }
    }
    // Add support for other operators
    case "-":
    case "*":
    case "/": {
      // These operators only work on numeric types
      const numericType = primitive(Types.Number);
      unify(leftType, numericType, node.left);
      unify(rightType, numericType, node.right);
      return numericType;
    }
    case ">":
    case "<":
    case ">=":
    case "<=": {
      // Comparison operators work on numeric types and return boolean
      const numericType = primitive(Types.Number);
      unify(leftType, numericType, node.left);
      unify(rightType, numericType, node.right);
      return primitive(Types.Bool);
    }
    case "==":
    case "!=": {
      // Equality operators require the same type on both sides
      unify(leftType, rightType, node);
      return primitive(Types.Bool);
    }
    default:
      reportError(
        `Unsupported binary operator: ${node.operator}`,
        node,
      );
      return newTypeVar();
  }
}

/**
 * Infer type for a conditional (ternary) expression
 *
 * @param {object} node - Ternary node with { condition, thenBranch, elseBranch } fields
 * @returns {object} - Inferred type
 */
function inferTernary(node) {
  // test ? consequent : alternate

  // The condition must be a boolean
  const conditionType = infer(node.test);
  unify(conditionType, primitive(Types.Bool), node.test);

  // Infer types for both branches
  const thenBranchType = infer(node.consequent);
  const elseBranchType = infer(node.alternate);

  // Both branches must have the same type
  // Create a result type and unify both branches with it
  const resultType = newTypeVar(null, "Ternary condition result");
  unify(thenBranchType, resultType, node.consequent);
  unify(elseBranchType, resultType, node.alternate);

  return resultType;
}

/**
 * Infer type for a function
 *
 * @param {object} node - Function node
 * @returns {object} - Inferred type
 */
function inferTypeFunction(node) {
  pushScope();
  const outerNonGeneric = nonGeneric;
  nonGeneric = new Set(outerNonGeneric);

  // Return statement position validation is now done in the validate.js module

  // Create types for parameters, using annotations if available
  const paramTypes = [];
  for (const param of node.params) {
    let paramType;

    // If parameter has a type annotation, use it
    if (param.typeAnnotation) {
      paramType = createTypeFromAnnotation(param.typeAnnotation);
    } else {
      // Otherwise use a fresh type variable
      paramType = newTypeVar(null, `Parameter ${param.name}`);
    }

    currentScope[param.name] = paramType;
    nonGeneric.add(paramType);
    paramTypes.push(paramType);
  }

  // Infer the return type
  let returnType;
  let inferredReturnType;

  const returnStatement = node.body.find(
    (stmt) => stmt.type === "ReturnStatement",
  );

  if (returnStatement) {
    if (returnStatement.argument) {
      inferredReturnType = infer(returnStatement.argument);
    } else {
      inferredReturnType = primitive(Types.Void);
    }

    // Process all statements for side effects and type checking
    for (const statement of node.body) {
      if (statement !== returnStatement) {
        infer(statement);
      }
    }
  } else {
    // No return statement, process all statements
    for (const statement of node.body) {
      infer(statement);
    }
    inferredReturnType = primitive(Types.Void);
  }

  // If there's a return type annotation, use it and unify with inferred type
  if (node.returnTypeAnnotation) {
    returnType = createTypeFromAnnotation(node.returnTypeAnnotation);
    unify(inferredReturnType, returnType, node);
  } else {
    // No annotation, use the inferred type
    returnType = inferredReturnType;
  }

  // Construct the function type
  const functionType = createFunctionType(paramTypes, returnType);

  scopes.pop();
  nonGeneric = outerNonGeneric;

  return functionType;
}

/**
 * Infer type for an array literal
 *
 * For array literals, we:
 * 1. Infer the type of each element
 * 2. Unify all element types to ensure homogeneity
 * 3. Create an array type with the unified element type
 *
 * @param {object} node - Array literal node
 * @returns {object} - Inferred type
 */
function inferTypeArrayLiteral(node) {
  // Handle empty array case
  if (node.elements.length === 0) {
    // For empty arrays, we create a parametric array type
    const elemType = newTypeVar(null, "Empty array element type");
    return createArrayType(elemType);
  }

  // Get the type of the first element
  let elementType = infer(node.elements[0]);

  // Unify all remaining elements with the first one to ensure homogeneity
  for (let i = 1; i < node.elements.length; i++) {
    const nextElemType = infer(node.elements[i]);

    // Ensure all elements have the same type
    unify(elementType, nextElemType, node.elements[i]);
  }

  // Create array type with the element type
  return createArrayType(elementType);
}

/**
 * Infer type for a member expression (array indexing)
 *
 * For array indexing like arr[index], we:
 * 1. Ensure the object is an array type
 * 2. Ensure the index is a numeric type (Number)
 * 3. Return the element type of the array
 *
 * @param {object} node - Member expression node
 * @returns {object} - Inferred type
 */
function inferTypeMemberExpression(node) {
  // Get the type of the object being indexed
  let objectType = infer(node.object);
  objectType = compress(objectType);  // Make sure we have the most specific type

  // Get the type of the index
  let indexType = infer(node.index);

  // The index should be a Number
  unify(indexType, primitive(Types.Number), node.index);

  // If object is already an array type, extract its element type
  if (objectType.kind === "ArrayType") {
    return objectType.elementType;
  }

  // If object is not already an array type, create a type variable for the element type
  // and unify the object with an array of that element type
  const elementType = newTypeVar(null, "Array access element type");
  const arrayType = createArrayType(elementType);

  // Unify the object type with the array type
  unify(objectType, arrayType, node.object);

  // The result type is the element type of the array
  return elementType;
}

/**
 * Convert a type annotation to an internal type representation
 *
 * @param {object} annotation - Type annotation node
 * @returns {object} - Internal type representation
 */
function createTypeFromAnnotation(annotation) {

  switch (annotation.type) {
    case "TypeAnnotation": {
      // Convert string type names to our internal type system
      switch (annotation.valueType) {
        case "number":
          return primitive(Types.Number);

        case "string":
          return primitive(Types.String);

        case "boolean":
          return primitive(Types.Bool);

        case "void":
          return primitive(Types.Void);

        default:
          // For custom/unknown types, use a type variable
          return newTypeVar(null, `Unknown type annotation: ${annotation.valueType}`);
      }
    }

    case "ArrayTypeAnnotation": {
      // For Array<T> or T[], create an array type with the element type
      const elementType = createTypeFromAnnotation(
        annotation.elementType,
      );
      return createArrayType(elementType);
    }

    case "FunctionTypeAnnotation": {
      // Get the return type
      const returnType = createTypeFromAnnotation(annotation.returnType);

      // Convert all parameter types
      const paramTypes = annotation.paramTypes.map(param =>
        createTypeFromAnnotation(param.typeAnnotation)
      );

      // Create a function type with all parameters at once
      return createFunctionType(paramTypes, returnType);
    }

    default:
      return newTypeVar();
  }
}

/**
 * Infer type for a const declaration
 *
 * @param {object} node - Const declaration node
 * @returns {object} - Inferred type
 */
function inferTypeConstDeclaration(node) {
  // Infer type from the initializer
  let initType = infer(node.init);

  // If there's a type annotation, create a concrete type from it
  if (node.typeAnnotation) {
    const annotatedType = createTypeFromAnnotation(node.typeAnnotation);

    // Unify the inferred type with the annotated type
    unify(initType, annotatedType, node);

    // Use the annotated type
    currentScope[node.id.name] = annotatedType;

    // Add type information to the parse tree
    node.inferredType = annotatedType;

    return annotatedType;
  }

  // No annotation, use the inferred type
  currentScope[node.id.name] = initType;

  // Add type information to the parse tree
  node.inferredType = initType;

  return initType;
}

/**
 * Infer type for a return statement
 *
 * @param {object} node - Return statement node
 * @returns {object} - Inferred type
 */
function inferTypeReturnStatement(node) {
  return infer(node.argument);
}

/**
 * Infer type for an expression statement
 *
 * @param {object} node - Expression statement node
 * @returns {object} - Inferred type
 */
function inferTypeExpressionStatement(node) {
  return infer(node.expression);
}

/**
 * Analyze the parse tree and infer types
 *
 * @param {object} node - parse tree to analyze
 * @param {Array} nameErrors - Errors from name checking phase
 * @returns {object} - Result with parse tree and errors
 */
function typecheck(node, nameErrors) {
  errors = [];
  currentScope = {};
  nonGeneric = new Set();
  nextTypeVarId = 0;

  // If we have name errors, don't bother typechecking
  if (nameErrors && nameErrors.length > 0) {
    return { errors: nameErrors };
  }

  // Handle case where node is an array of statements
  if (Array.isArray(node)) {
    // Create a program node
    const programNode = {
      type: "Program",
      body: node
    };
    infer(programNode);
  } else {
    infer(node);
  }

  return { errors };
}

module.exports = {
  typecheck,
  Types,
  typeToString,
  createArrayType,
};
