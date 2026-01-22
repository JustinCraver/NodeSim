import type { EconEdgeData, EconNodeData, GraphComputeResult, TimeUnit } from '../models/types';

type TokenType = 'number' | 'identifier' | 'operator' | 'lparen' | 'rparen' | 'comma';

type Token = {
  type: TokenType;
  value: string;
};

type RpnToken =
  | { type: 'number'; value: number }
  | { type: 'identifier'; value: string }
  | { type: 'operator'; value: string }
  | { type: 'function'; value: string; argCount: number };

const TIME_UNIT_MULTIPLIERS: Record<TimeUnit, number> = {
  per_day: 30,
  per_week: 52 / 12,
  per_month: 1,
  per_year: 1 / 12,
};

const OPERATORS: Record<string, { precedence: number; assoc: 'left' | 'right'; args: number }> = {
  '+': { precedence: 1, assoc: 'left', args: 2 },
  '-': { precedence: 1, assoc: 'left', args: 2 },
  '*': { precedence: 2, assoc: 'left', args: 2 },
  '/': { precedence: 2, assoc: 'left', args: 2 },
  'u-': { precedence: 3, assoc: 'right', args: 1 },
};

const FUNCTIONS = new Set(['sum', 'min', 'max']);

const normalizeMonthlyValue = (value: number | undefined, unit: TimeUnit | undefined) => {
  if (value === undefined) {
    return 0;
  }
  const multiplier = unit ? TIME_UNIT_MULTIPLIERS[unit] : 1;
  return value * multiplier;
};

const tokenize = (expression: string): Token[] => {
  const tokens: Token[] = [];
  const regex = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[()+\-*/]|,)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(expression)) !== null) {
    const value = match[1];
    if (!Number.isNaN(Number(value))) {
      tokens.push({ type: 'number', value });
    } else if (value === '(') {
      tokens.push({ type: 'lparen', value });
    } else if (value === ')') {
      tokens.push({ type: 'rparen', value });
    } else if (value === ',') {
      tokens.push({ type: 'comma', value });
    } else if (value === '+' || value === '-' || value === '*' || value === '/') {
      tokens.push({ type: 'operator', value });
    } else {
      tokens.push({ type: 'identifier', value });
    }
  }

  return tokens;
};

const toRpn = (tokens: Token[]): RpnToken[] => {
  const output: RpnToken[] = [];
  const operators: Token[] = [];
  const argCounts: number[] = [];

  const getPrevTokenType = (index: number) => {
    if (index === 0) {
      return null;
    }
    for (let i = index - 1; i >= 0; i -= 1) {
      const token = tokens[i];
      if (token.type !== 'comma') {
        return token.type;
      }
    }
    return null;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    switch (token.type) {
      case 'number':
        output.push({ type: 'number', value: Number(token.value) });
        break;
      case 'identifier': {
        const next = tokens[i + 1];
        if (next?.type === 'lparen') {
          operators.push(token);
          argCounts.push(0);
        } else {
          output.push({ type: 'identifier', value: token.value });
        }
        break;
      }
      case 'operator': {
        const prevType = getPrevTokenType(i);
        const opValue =
          token.value === '-' && (prevType === null || prevType === 'operator' || prevType === 'lparen' || prevType === 'comma')
            ? 'u-'
            : token.value;
        const opInfo = OPERATORS[opValue];
        while (operators.length > 0) {
          const top = operators[operators.length - 1];
          if (top.type === 'operator') {
            const topInfo = OPERATORS[top.value];
            if (
              (opInfo.assoc === 'left' && opInfo.precedence <= topInfo.precedence) ||
              (opInfo.assoc === 'right' && opInfo.precedence < topInfo.precedence)
            ) {
              output.push({ type: 'operator', value: operators.pop()!.value });
              continue;
            }
          } else if (top.type === 'identifier') {
            break;
          }
          break;
        }
        operators.push({ type: 'operator', value: opValue });
        break;
      }
      case 'lparen':
        operators.push(token);
        break;
      case 'comma':
        while (operators.length > 0 && operators[operators.length - 1].type !== 'lparen') {
          const op = operators.pop()!;
          if (op.type === 'operator') {
            output.push({ type: 'operator', value: op.value });
          } else {
            output.push({ type: 'identifier', value: op.value });
          }
        }
        if (argCounts.length > 0) {
          argCounts[argCounts.length - 1] += 1;
        }
        break;
      case 'rparen':
        while (operators.length > 0 && operators[operators.length - 1].type !== 'lparen') {
          const op = operators.pop()!;
          if (op.type === 'operator') {
            output.push({ type: 'operator', value: op.value });
          } else {
            output.push({ type: 'identifier', value: op.value });
          }
        }
        if (operators.length === 0) {
          throw new Error('Mismatched parentheses');
        }
        operators.pop();
        if (operators.length > 0 && operators[operators.length - 1].type === 'identifier') {
          const funcToken = operators.pop()!;
          const argCount = (argCounts.pop() ?? 0) + 1;
          output.push({ type: 'function', value: funcToken.value, argCount });
        }
        break;
      default:
        break;
    }
  }

  while (operators.length > 0) {
    const op = operators.pop()!;
    if (op.type === 'lparen' || op.type === 'rparen') {
      throw new Error('Mismatched parentheses');
    }
    if (op.type === 'operator') {
      output.push({ type: 'operator', value: op.value });
    } else {
      output.push({ type: 'identifier', value: op.value });
    }
  }

  return output;
};

const evaluateRpn = (tokens: RpnToken[], variables: Record<string, number>) => {
  const stack: number[] = [];
  for (const token of tokens) {
    if (token.type === 'number') {
      stack.push(token.value);
      continue;
    }
    if (token.type === 'identifier') {
      if (!(token.value in variables)) {
        throw new Error(`Unknown variable: ${token.value}`);
      }
      stack.push(variables[token.value]);
      continue;
    }
    if (token.type === 'operator') {
      const op = OPERATORS[token.value];
      if (stack.length < op.args) {
        throw new Error('Invalid expression');
      }
      if (token.value === 'u-') {
        const value = stack.pop()!;
        stack.push(-value);
        continue;
      }
      const right = stack.pop()!;
      const left = stack.pop()!;
      switch (token.value) {
        case '+':
          stack.push(left + right);
          break;
        case '-':
          stack.push(left - right);
          break;
        case '*':
          stack.push(left * right);
          break;
        case '/':
          stack.push(left / right);
          break;
        default:
          break;
      }
      continue;
    }
    if (token.type === 'function') {
      if (!FUNCTIONS.has(token.value)) {
        throw new Error(`Unsupported function: ${token.value}`);
      }
      if (stack.length < token.argCount) {
        throw new Error('Invalid function usage');
      }
      const args = stack.splice(stack.length - token.argCount, token.argCount);
      if (args.length === 0) {
        throw new Error('Functions require at least one argument');
      }
      switch (token.value) {
        case 'sum':
          stack.push(args.reduce((total, val) => total + val, 0));
          break;
        case 'min':
          stack.push(Math.min(...args));
          break;
        case 'max':
          stack.push(Math.max(...args));
          break;
        default:
          break;
      }
    }
  }
  if (stack.length !== 1) {
    throw new Error('Invalid expression');
  }
  return stack[0];
};

const evaluateFormula = (formula: string, variables: Record<string, number>) => {
  const tokens = tokenize(formula);
  const rpn = toRpn(tokens);
  return evaluateRpn(rpn, variables);
};

const buildIncomingMap = (edges: EconEdgeData[]) => {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }
  return incoming;
};

export const computeGraph = (nodes: EconNodeData[], edges: EconEdgeData[]): GraphComputeResult => {
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node }]));
  const errors: Record<string, string> = {};

  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodes.forEach((node) => {
    inDegree.set(node.id, 0);
    outgoing.set(node.id, []);
  });

  edges.forEach((edge) => {
    if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) {
      return;
    }
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  });

  const queue: string[] = [];
  inDegree.forEach((value, key) => {
    if (value === 0) {
      queue.push(key);
    }
  });

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const targets = outgoing.get(id) ?? [];
    for (const target of targets) {
      const nextValue = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, nextValue);
      if (nextValue === 0) {
        queue.push(target);
      }
    }
  }

  if (order.length !== nodes.length) {
    nodes.forEach((node) => {
      errors[node.id] = 'Cycle detected in graph';
    });
    return { nodes: Array.from(nodeMap.values()), errors };
  }

  const incomingMap = buildIncomingMap(edges);

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      continue;
    }
    const incomingIds = incomingMap.get(nodeId) ?? [];
    const incomingValues = incomingIds.map((id) => nodeMap.get(id)?.computedValue ?? 0);

    try {
      switch (node.kind) {
        case 'income':
        case 'expense':
          node.computedValue = normalizeMonthlyValue(node.baseValue, node.timeUnit);
          break;
        case 'calc': {
          if (!node.formula) {
            throw new Error('Missing formula');
          }
          const variables: Record<string, number> = {};
          incomingIds.forEach((id, index) => {
            variables[id] = incomingValues[index] ?? 0;
          });
          node.computedValue = evaluateFormula(node.formula, variables);
          break;
        }
        case 'asset': {
          const contribution = incomingValues.reduce((sum, val) => sum + val, 0);
          const rate = node.interestRateAnnual ?? 0;
          const monthlyRate = rate / 12;
          const months = 120;
          const timeseries: number[] = [];
          let balance = 0;
          for (let i = 0; i < months; i += 1) {
            balance = balance * (1 + monthlyRate) + contribution;
            timeseries.push(balance);
          }
          node.timeseries = timeseries;
          node.computedValue = balance;
          break;
        }
        case 'output': {
          if (node.targetAmount === undefined) {
            throw new Error('Missing target amount');
          }
          const sourceAssets = incomingIds
            .map((id) => nodeMap.get(id))
            .filter((item): item is EconNodeData => Boolean(item));
          const combinedSeries = sourceAssets.reduce<number[]>((acc, asset) => {
            if (!asset.timeseries) {
              return acc;
            }
            if (acc.length === 0) {
              return [...asset.timeseries];
            }
            return acc.map((value, index) => value + (asset.timeseries?.[index] ?? 0));
          }, []);
          const series = combinedSeries.length > 0 ? combinedSeries : undefined;
          if (!series) {
            throw new Error('Missing asset timeseries');
          }
          const monthIndex = series.findIndex((value) => value >= node.targetAmount!);
          node.computedValue = monthIndex === -1 ? -1 : monthIndex + 1;
          break;
        }
        default:
          break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Calculation error';
      errors[node.id] = message;
      node.computedValue = undefined;
      node.timeseries = undefined;
    }
  }

  return { nodes: Array.from(nodeMap.values()), errors };
};
