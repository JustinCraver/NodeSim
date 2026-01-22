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
          token.value === '-' && (prevType === null || prevType === 'operator' || prevType === 'lparen')
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

const getDefaultPortId = (ports: { id: string }[] | undefined) => ports?.[0]?.id;

const buildIncomingMap = (edges: EconEdgeData[]) => {
  const incoming = new Map<string, EconEdgeData[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }
  return incoming;
};

export const computeGraph = (nodes: EconNodeData[], edges: EconEdgeData[]): GraphComputeResult => {
  const nodeMap = new Map(nodes.map((node) => [node.id, { ...node }]));
  const errors: Record<string, string> = {};
  const customOutputs = new Map<string, Map<string, number>>();

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
  const getEdgeValue = (edge: EconEdgeData) => {
    const sourceNode = nodeMap.get(edge.source);
    if (!sourceNode) {
      return 0;
    }
    if (sourceNode.kind === 'custom') {
      const portId = edge.sourcePort ?? getDefaultPortId(sourceNode.custom?.outputs);
      if (!portId) {
        return 0;
      }
      const outputs = customOutputs.get(sourceNode.id);
      return outputs?.get(portId) ?? 0;
    }
    return sourceNode.computedValue ?? 0;
  };

  for (const nodeId of order) {
    const node = nodeMap.get(nodeId);
    if (!node) {
      continue;
    }
    const incomingEdges = incomingMap.get(nodeId) ?? [];
    const incomingValues = incomingEdges.map((edge) => getEdgeValue(edge));
    const incomingIds = incomingEdges.map((edge) => edge.source);

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
            const value = incomingValues[index] ?? 0;
            variables[id] = (variables[id] ?? 0) + value;
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
        case 'custom': {
          const customConfig = node.custom;
          if (!customConfig) {
            throw new Error('Missing custom config');
          }
          const inputPortIds = new Set(customConfig.inputs.map((port) => port.id));
          const defaultInputPortId = getDefaultPortId(customConfig.inputs);
          const defaultOutputPortId = getDefaultPortId(customConfig.outputs);
          const inputTotals = new Map<string, number>();
          const bindingErrors: string[] = [];

          if (customConfig.inputs.length === 0) {
            bindingErrors.push('Custom node has no input ports');
          }
          if (customConfig.outputs.length === 0) {
            bindingErrors.push('Custom node has no output ports');
          }

          incomingEdges.forEach((edge, index) => {
            const requestedPort = edge.targetPort ?? defaultInputPortId;
            if (!requestedPort) {
              return;
            }
            if (!inputPortIds.has(requestedPort)) {
              bindingErrors.push(`Unknown input port ${requestedPort}`);
              return;
            }
            const value = incomingValues[index] ?? 0;
            inputTotals.set(requestedPort, (inputTotals.get(requestedPort) ?? 0) + value);
          });

          const internalNodes = customConfig.internalGraph.nodes.map((internal) => ({ ...internal }));
          const internalEdges = customConfig.internalGraph.edges.map((internal) => ({ ...internal }));
          const internalNodeMap = new Map(internalNodes.map((internal) => [internal.id, internal]));

          customConfig.inputs.forEach((port) => {
            const boundId = customConfig.inputBindings[port.id];
            if (!boundId) {
              bindingErrors.push(`Missing input binding for ${port.id}`);
              return;
            }
            const targetNode = internalNodeMap.get(boundId);
            if (!targetNode) {
              bindingErrors.push(`Invalid input binding for ${port.id}`);
              return;
            }
            if (targetNode.kind !== 'income') {
              bindingErrors.push(`Input binding ${port.id} must target income`);
              return;
            }
            const value = inputTotals.get(port.id) ?? 0;
            targetNode.baseValue = value;
            targetNode.timeUnit = 'per_month';
          });

          const internalResult = computeGraph(internalNodes, internalEdges);
          if (Object.keys(internalResult.errors).length > 0) {
            bindingErrors.push('Internal graph errors');
          }

          const outputValues = new Map<string, number>();
          customConfig.outputs.forEach((port) => {
            const boundId = customConfig.outputBindings[port.id];
            if (!boundId) {
              bindingErrors.push(`Missing output binding for ${port.id}`);
              outputValues.set(port.id, 0);
              return;
            }
            const sourceNode = internalResult.nodes.find((item) => item.id === boundId);
            if (!sourceNode) {
              bindingErrors.push(`Invalid output binding for ${port.id}`);
              outputValues.set(port.id, 0);
              return;
            }
            outputValues.set(port.id, sourceNode.computedValue ?? 0);
          });

          if (!defaultOutputPortId) {
            node.computedValue = 0;
          } else if (customConfig.outputs.length === 1) {
            node.computedValue = outputValues.get(defaultOutputPortId) ?? 0;
          } else {
            node.computedValue = customConfig.outputs.reduce((sum, port) => sum + (outputValues.get(port.id) ?? 0), 0);
          }

          if (bindingErrors.length > 0) {
            errors[node.id] = bindingErrors.join('; ');
          }
          customOutputs.set(node.id, outputValues);
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
