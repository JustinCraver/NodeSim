import type { FormulaValueType, RuntimeValue } from '../models/types';

type FormulaValue = Extract<RuntimeValue, { type: FormulaValueType }>;

type Token =
  | { type: 'number'; value: number; position: number }
  | { type: 'identifier'; value: string; position: number }
  | { type: 'operator'; value: '+' | '-' | '*' | '/'; position: number }
  | { type: 'lparen' | 'rparen' | 'comma' | 'end'; position: number };

type Expression =
  | { kind: 'number'; value: number }
  | { kind: 'reference'; identifier: string }
  | { kind: 'prefix'; operand: Expression }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: Expression; right: Expression }
  | { kind: 'call'; name: string; arguments: Expression[] };

const FUNCTIONS = new Set(['sum', 'min', 'max']);
const isIdentifierStart = (character: string) => /[A-Za-z_]/.test(character);
const isIdentifierPart = (character: string) => /[A-Za-z0-9_]/.test(character);

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  const readIdentifierSegment = () => {
    const start = index;
    index += 1;
    while (index < source.length && isIdentifierPart(source[index])) {
      index += 1;
    }
    return source.slice(start, index);
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    const position = index;
    if (/\d/.test(character) || character === '.') {
      const start = index;
      if (character === '.') {
        index += 1;
        if (index >= source.length || !/\d/.test(source[index])) {
          throw new Error(`Invalid number at position ${position}`);
        }
        while (index < source.length && /\d/.test(source[index])) {
          index += 1;
        }
      } else {
        while (index < source.length && /\d/.test(source[index])) {
          index += 1;
        }
        if (source[index] === '.') {
          index += 1;
          if (index >= source.length || !/\d/.test(source[index])) {
            throw new Error(`Invalid number at position ${position}`);
          }
          while (index < source.length && /\d/.test(source[index])) {
            index += 1;
          }
        }
      }
      const value = Number(source.slice(start, index));
      if (!Number.isFinite(value)) {
        throw new Error(`Non-finite number at position ${position}`);
      }
      tokens.push({ type: 'number', value, position });
      continue;
    }

    if (isIdentifierStart(character)) {
      let value = readIdentifierSegment();
      if (source[index] === '.') {
        index += 1;
        if (index >= source.length || !isIdentifierStart(source[index])) {
          throw new Error(`Invalid output identifier at position ${index}`);
        }
        value += `.${readIdentifierSegment()}`;
      }
      tokens.push({ type: 'identifier', value, position });
      continue;
    }

    if (character === '+' || character === '-' || character === '*' || character === '/') {
      tokens.push({ type: 'operator', value: character, position });
      index += 1;
      continue;
    }
    if (character === '(') {
      tokens.push({ type: 'lparen', position });
      index += 1;
      continue;
    }
    if (character === ')') {
      tokens.push({ type: 'rparen', position });
      index += 1;
      continue;
    }
    if (character === ',') {
      tokens.push({ type: 'comma', position });
      index += 1;
      continue;
    }

    throw new Error(`Unexpected character "${character}" at position ${position}`);
  }

  tokens.push({ type: 'end', position: source.length });
  return tokens;
};

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): Expression {
    if (this.peek().type === 'end') {
      throw new Error('Invalid expression');
    }
    const expression = this.parseAdditive();
    const trailing = this.peek();
    if (trailing.type !== 'end') {
      if (trailing.type === 'rparen' || trailing.type === 'lparen') {
        throw new Error('Mismatched parentheses');
      }
      throw new Error(`Unexpected token at position ${trailing.position}`);
    }
    return expression;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private consume() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private parseAdditive(): Expression {
    let expression = this.parseMultiplicative();
    while (true) {
      const next = this.peek();
      if (next.type !== 'operator' || (next.value !== '+' && next.value !== '-')) {
        break;
      }
      const operator = this.consume() as Extract<Token, { type: 'operator' }>;
      expression = {
        kind: 'binary',
        operator: operator.value as '+' | '-',
        left: expression,
        right: this.parseMultiplicative(),
      };
    }
    return expression;
  }

  private parseMultiplicative(): Expression {
    let expression = this.parsePrefix();
    while (true) {
      const next = this.peek();
      if (next.type !== 'operator' || (next.value !== '*' && next.value !== '/')) {
        break;
      }
      const operator = this.consume() as Extract<Token, { type: 'operator' }>;
      expression = {
        kind: 'binary',
        operator: operator.value as '*' | '/',
        left: expression,
        right: this.parsePrefix(),
      };
    }
    return expression;
  }

  private parsePrefix(): Expression {
    const next = this.peek();
    if (next.type === 'operator' && next.value === '-') {
      this.consume();
      return { kind: 'prefix', operand: this.parsePrimary() };
    }
    if (next.type === 'operator') {
      throw new Error(`Unexpected operator "${next.value}" at position ${next.position}`);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expression {
    const token = this.consume();
    if (token.type === 'number') {
      return { kind: 'number', value: token.value };
    }
    if (token.type === 'identifier') {
      if (this.peek().type !== 'lparen') {
        return { kind: 'reference', identifier: token.value };
      }
      this.consume();
      if (!FUNCTIONS.has(token.value)) {
        throw new Error(`Unsupported function: ${token.value}`);
      }
      if (this.peek().type === 'rparen') {
        throw new Error('Functions require at least one argument');
      }
      const argumentsList: Expression[] = [this.parseAdditive()];
      while (this.peek().type === 'comma') {
        this.consume();
        if (this.peek().type === 'comma' || this.peek().type === 'rparen' || this.peek().type === 'end') {
          throw new Error(`Missing function argument at position ${this.peek().position}`);
        }
        argumentsList.push(this.parseAdditive());
      }
      if (this.peek().type !== 'rparen') {
        throw new Error('Mismatched parentheses');
      }
      this.consume();
      return { kind: 'call', name: token.value, arguments: argumentsList };
    }
    if (token.type === 'lparen') {
      const expression = this.parseAdditive();
      if (this.peek().type !== 'rparen') {
        throw new Error('Mismatched parentheses');
      }
      this.consume();
      return expression;
    }
    if (token.type === 'rparen' || token.type === 'end') {
      throw new Error(token.type === 'rparen' ? 'Mismatched parentheses' : 'Invalid expression');
    }
    throw new Error(`Unexpected token at position ${token.position}`);
  }
}

const parseFormula = (source: string) => new Parser(tokenize(source)).parse();

const assertFinite = (value: number, context: string) => {
  if (!Number.isFinite(value)) {
    throw new Error(`Non-finite result in ${context}`);
  }
  return value;
};

const assertMatchingSamples = (left: number[], right: number[]) => {
  if (left.length !== right.length) {
    throw new Error('Monthly-flow horizons do not match');
  }
};

const inferExpressionType = (
  expression: Expression,
  variables: Readonly<Record<string, FormulaValueType>>,
): FormulaValueType => {
  switch (expression.kind) {
    case 'number':
      return 'scalar';
    case 'reference': {
      const type = variables[expression.identifier];
      if (!type) {
        throw new Error(`Unknown variable: ${expression.identifier}`);
      }
      return type;
    }
    case 'prefix':
      return inferExpressionType(expression.operand, variables);
    case 'binary': {
      const left = inferExpressionType(expression.left, variables);
      const right = inferExpressionType(expression.right, variables);
      if (expression.operator === '+' || expression.operator === '-') {
        if (left !== right) {
          throw new Error(`${expression.operator} requires matching value types`);
        }
        return left;
      }
      if (expression.operator === '*') {
        if (left === 'scalar' && right === 'scalar') {
          return 'scalar';
        }
        if (
          (left === 'scalar' && right === 'monthly-flow') ||
          (left === 'monthly-flow' && right === 'scalar')
        ) {
          return 'monthly-flow';
        }
        throw new Error('Multiply supports scalar × scalar or scalar × monthly-flow');
      }
      if (right !== 'scalar') {
        throw new Error('Divide requires a scalar divisor');
      }
      return left;
    }
    case 'call': {
      const argumentTypes = expression.arguments.map((argument) => inferExpressionType(argument, variables));
      const firstType = argumentTypes[0];
      if (!argumentTypes.every((type) => type === firstType)) {
        throw new Error(`${expression.name} requires matching value types`);
      }
      return firstType;
    }
  }
};

const evaluateExpression = (
  expression: Expression,
  variables: Readonly<Record<string, FormulaValue>>,
): FormulaValue => {
  switch (expression.kind) {
    case 'number':
      return { type: 'scalar', value: expression.value };
    case 'reference': {
      const value = variables[expression.identifier];
      if (!value) {
        throw new Error(`Unknown variable: ${expression.identifier}`);
      }
      return value.type === 'scalar'
        ? { type: 'scalar', value: value.value }
        : { type: 'monthly-flow', samples: [...value.samples] };
    }
    case 'prefix': {
      const value = evaluateExpression(expression.operand, variables);
      return value.type === 'scalar'
        ? { type: 'scalar', value: assertFinite(-value.value, 'unary minus') }
        : {
            type: 'monthly-flow',
            samples: value.samples.map((sample) => assertFinite(-sample, 'unary minus')),
          };
    }
    case 'binary': {
      const left = evaluateExpression(expression.left, variables);
      const right = evaluateExpression(expression.right, variables);

      if (expression.operator === '+' || expression.operator === '-') {
        if (left.type !== right.type) {
          throw new Error(`${expression.operator} requires matching value types`);
        }
        const operation = expression.operator === '+' ? (a: number, b: number) => a + b : (a: number, b: number) => a - b;
        if (left.type === 'scalar' && right.type === 'scalar') {
          return { type: 'scalar', value: assertFinite(operation(left.value, right.value), expression.operator) };
        }
        if (left.type === 'monthly-flow' && right.type === 'monthly-flow') {
          assertMatchingSamples(left.samples, right.samples);
          return {
            type: 'monthly-flow',
            samples: left.samples.map((sample, index) =>
              assertFinite(operation(sample, right.samples[index]), expression.operator),
            ),
          };
        }
      }

      if (expression.operator === '*') {
        if (left.type === 'scalar' && right.type === 'scalar') {
          return { type: 'scalar', value: assertFinite(left.value * right.value, 'multiplication') };
        }
        if (left.type === 'scalar' && right.type === 'monthly-flow') {
          return {
            type: 'monthly-flow',
            samples: right.samples.map((sample) => assertFinite(left.value * sample, 'multiplication')),
          };
        }
        if (left.type === 'monthly-flow' && right.type === 'scalar') {
          return {
            type: 'monthly-flow',
            samples: left.samples.map((sample) => assertFinite(sample * right.value, 'multiplication')),
          };
        }
        throw new Error('Multiply supports scalar × scalar or scalar × monthly-flow');
      }

      if (expression.operator === '/') {
        if (right.type !== 'scalar') {
          throw new Error('Divide requires a scalar divisor');
        }
        if (right.value === 0) {
          throw new Error('Division by zero');
        }
        if (left.type === 'scalar') {
          return { type: 'scalar', value: assertFinite(left.value / right.value, 'division') };
        }
        return {
          type: 'monthly-flow',
          samples: left.samples.map((sample) => assertFinite(sample / right.value, 'division')),
        };
      }
      throw new Error('Invalid expression');
    }
    case 'call': {
      const values = expression.arguments.map((argument) => evaluateExpression(argument, variables));
      const first = values[0];
      if (!first || !values.every((value) => value.type === first.type)) {
        throw new Error(`${expression.name} requires matching value types`);
      }
      const reduce = (samples: number[]) => {
        if (expression.name === 'sum') {
          return samples.reduce((total, sample) => total + sample, 0);
        }
        return expression.name === 'min' ? Math.min(...samples) : Math.max(...samples);
      };
      if (first.type === 'scalar') {
        const scalars = values.map((value) => (value as Extract<FormulaValue, { type: 'scalar' }>).value);
        return { type: 'scalar', value: assertFinite(reduce(scalars), expression.name) };
      }
      const flows = values as Extract<FormulaValue, { type: 'monthly-flow' }>[];
      flows.slice(1).forEach((flow) => assertMatchingSamples(first.samples, flow.samples));
      return {
        type: 'monthly-flow',
        samples: first.samples.map((_, index) =>
          assertFinite(
            reduce(flows.map((flow) => flow.samples[index])),
            expression.name,
          ),
        ),
      };
    }
  }
};

export const inferFormulaType = (
  formula: string,
  variables: Readonly<Record<string, FormulaValueType>>,
): FormulaValueType => inferExpressionType(parseFormula(formula), variables);

export const evaluateFormula = (
  formula: string,
  variables: Readonly<Record<string, FormulaValue>>,
  expectedType?: FormulaValueType,
): FormulaValue => {
  const expression = parseFormula(formula);
  const inferredType = inferExpressionType(
    expression,
    Object.fromEntries(Object.entries(variables).map(([identifier, value]) => [identifier, value.type])),
  );
  if (expectedType && inferredType !== expectedType) {
    throw new Error(`Formula declares ${expectedType} but evaluates to ${inferredType}`);
  }
  return evaluateExpression(expression, variables);
};
