"""Independent exact references for the unapproved ADR 0002 proposal.

This is a design oracle, not NodeSim's engine or a financial acceptance gate.
All decimal inputs are text. Fraction rounding and Decimal ROUND_HALF_EVEN
are compared independently, including every sample of the long-horizon cases.
"""

import argparse
import hashlib
import json
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from fractions import Fraction
from pathlib import Path

LIMIT = 10**12


def fraction_round(value, places):
    if abs(value) > LIMIT:
        raise ValueError("proposed magnitude bound exceeded")
    sign = -1 if value < 0 else 1
    numerator = abs(value.numerator) * 10**places
    quotient, remainder = divmod(numerator, value.denominator)
    twice = 2 * remainder
    if twice > value.denominator or (twice == value.denominator and quotient % 2):
        quotient += 1
    return Fraction(sign * quotient, 10**places)


def decimal_round(value, places):
    if abs(value) > LIMIT:
        raise ValueError("proposed magnitude bound exceeded")
    return value.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_EVEN)


def fixed_text(value, places, canonical=False):
    scaled = value * 10**places
    assert scaled.denominator == 1
    integer = scaled.numerator
    sign = "-" if integer < 0 else ""
    digits = str(abs(integer)).zfill(places + 1)
    text = sign + digits[:-places] + "." + digits[-places:]
    return text.rstrip("0").rstrip(".") if canonical else text


def assert_agree(fraction, decimal):
    assert fraction == Fraction(decimal), (fraction, decimal)


def nonnegative_input(text):
    value_f, value_d = Fraction(text), Decimal(text)
    assert (value_f < 0) == (value_d < 0)
    if value_f < 0:
        raise ValueError("negative authored magnitude before rounding")
    return fraction_round(value_f, 12)


def scalar_operation(left, right, operator):
    left_f = fraction_round(Fraction(left), 12)
    right_f = fraction_round(Fraction(right), 12)
    left_d = decimal_round(Decimal(left), 12)
    right_d = decimal_round(Decimal(right), 12)
    if operator == "+":
        raw_f, raw_d = left_f + right_f, left_d + right_d
    elif operator == "*":
        raw_f, raw_d = left_f * right_f, left_d * right_d
    elif operator == "/":
        raw_f, raw_d = left_f / right_f, left_d / right_d
    else:
        raise ValueError("unknown oracle operation")
    result_f = fraction_round(raw_f, 12)
    result_d = decimal_round(raw_d, 12)
    assert_agree(result_f, result_d)
    return fixed_text(result_f, 12, canonical=True)


def asset_reference(case):
    balance_f = fraction_round(fraction_round(Fraction(case["initial"]), 12), 2)
    balance_d = decimal_round(decimal_round(Decimal(case["initial"]), 12), 2)
    rate_f = fraction_round(fraction_round(Fraction(case["apr"]), 12) / 12, 12)
    rate_d = decimal_round(decimal_round(Decimal(case["apr"]), 12) / 12, 12)
    contribution_f = fraction_round(fraction_round(Fraction(case["contribution"]), 12), 2)
    contribution_d = decimal_round(decimal_round(Decimal(case["contribution"]), 12), 2)
    target_f = fraction_round(fraction_round(Fraction(case["target"]), 12), 2)
    target_d = decimal_round(decimal_round(Decimal(case["target"]), 12), 2)
    samples = []
    reached_f = reached_d = None
    for month in range(1, case["horizonMonths"] + 1):
        product_f = fraction_round(balance_f * (1 + rate_f), 12)
        product_d = decimal_round(balance_d * (1 + rate_d), 12)
        balance_f = fraction_round(product_f + contribution_f, 2)
        balance_d = decimal_round(product_d + contribution_d, 2)
        assert_agree(balance_f, balance_d)
        samples.append(fixed_text(balance_f, 2))
        if reached_f is None and balance_f >= target_f:
            reached_f = month
        if reached_d is None and balance_d >= target_d:
            reached_d = month
    assert reached_f == reached_d
    return {
        **case,
        "monthlyRate": fixed_text(rate_f, 12, canonical=True),
        "samples": samples,
        "endingBalance": samples[-1],
        "targetState": {"kind": "unreachable"} if reached_f is None else {"kind": "month", "month": reached_f},
    }


def references():
    rounding = []
    for text in ["1.005", "1.015", "-1.005", "-1.015", "2.675", "0.005", "-0.005", "0.015"]:
        value_f = fraction_round(fraction_round(Fraction(text), 12), 2)
        value_d = decimal_round(decimal_round(Decimal(text), 12), 2)
        assert_agree(value_f, value_d)
        rounding.append({"input": text, "money": fixed_text(value_f, 2)})
    assert [row["money"] for row in rounding[:4]] == ["1.00", "1.02", "-1.00", "-1.02"]
    scalar = [
        {"left": "0.1", "operator": "+", "right": "0.2"},
        {"left": "1", "operator": "/", "right": "3"},
        {"left": "0.333333333333", "operator": "*", "right": "3"},
        {"left": "999999999999.999999999999", "operator": "+", "right": "0.000000000001"},
    ]
    for case in scalar:
        case["result"] = scalar_operation(case["left"], case["right"], case["operator"])
    assert scalar[0]["result"] == "0.3"
    assert scalar[1]["result"] == "0.333333333333"
    assert scalar[2]["result"] == "0.999999999999"
    assert scalar[3]["result"] == "1000000000000"
    weighted_flows = []
    for amount, weight in [("0.03", "0.499999999999"), ("-0.03", "0.499999999999"), ("0.05", "0.1"), ("0.1", "0.1")]:
        amount_f = fraction_round(fraction_round(Fraction(amount), 12), 2)
        amount_d = decimal_round(decimal_round(Decimal(amount), 12), 2)
        weight_f = fraction_round(Fraction(weight), 12)
        weight_d = decimal_round(Decimal(weight), 12)
        result_f = fraction_round(fraction_round(amount_f * weight_f, 12), 2)
        result_d = decimal_round(decimal_round(amount_d * weight_d, 12), 2)
        assert_agree(result_f, result_d)
        weighted_flows.append({"amount": amount, "weight": weight, "result": fixed_text(result_f, 2)})
    assert weighted_flows[0]["result"] == "0.02"
    assert weighted_flows[1]["result"] == "-0.02"
    assert weighted_flows[2]["result"] == "0.00"
    assert weighted_flows[3]["result"] == "0.01"
    flows = []
    for text, multiplier in [("0.01", Fraction(52, 12)), ("0.001", Fraction(30)), ("-0.01", Fraction(52, 12))]:
        raw_f = fraction_round(Fraction(text), 12) * multiplier
        raw_d = decimal_round(Decimal(text), 12) * (Decimal(multiplier.numerator) / multiplier.denominator)
        money_f = fraction_round(fraction_round(raw_f, 12), 2)
        money_d = decimal_round(decimal_round(raw_d, 12), 2)
        assert_agree(money_f, money_d)
        flows.append({"authoredAmount": text, "normalizationRatio": str(multiplier), "monthlyFlow": fixed_text(money_f, 2)})
    assert flows[0]["monthlyFlow"] == "0.04"
    assert flows[1]["monthlyFlow"] == "0.03"
    cases = [
        {"id": "apr-and-contribution-boundary", "initial": "1000", "apr": "0.12", "contribution": "1", "target": "1022.11", "horizonMonths": 3},
        {"id": "apr-next-cent-boundary", "initial": "1000", "apr": "0.12", "contribution": "1", "target": "1022.12", "horizonMonths": 3},
        {"id": "tenths-zero-apr", "initial": "0", "apr": "0", "contribution": "0.1", "target": "1", "horizonMonths": 12},
        {"id": "1200-month-nominal-apr", "initial": "1000", "apr": "0.037", "contribution": "0.01", "target": "40000", "horizonMonths": 1200},
        {"id": "1200-month-negative-flow", "initial": "100", "apr": "0", "contribution": "-0.1", "target": "101", "horizonMonths": 1200},
    ]
    assets = [asset_reference(case) for case in cases]
    assert assets[0]["samples"] == ["1011.00", "1022.11", "1033.33"]
    assert assets[0]["targetState"] == {"kind": "month", "month": 2}
    assert assets[1]["targetState"] == {"kind": "month", "month": 3}
    assert assets[2]["targetState"] == {"kind": "month", "month": 10}
    assert assets[4]["endingBalance"] == "-20.00"
    assert assets[4]["targetState"] == {"kind": "unreachable"}
    controls = []
    for identifier, diagnostic, operation in [
        ("out-of-range-authored", "invalid_number", lambda: fraction_round(Fraction("1000000000000.000000000001"), 12)),
        ("out-of-range-intermediate", "invalid_number", lambda: scalar_operation("1000000000000", "0.000000000001", "+")),
        ("rounded-zero-divisor", "division_by_zero", lambda: scalar_operation("1", "0.0000000000004", "/")),
        ("negative-expense-before-rounding", "invalid_number", lambda: nonnegative_input("-0.0000000000004")),
        ("negative-initial-before-rounding", "invalid_number", lambda: nonnegative_input("-0.0000000000004")),
        ("negative-target-before-rounding", "invalid_number", lambda: nonnegative_input("-0.0000000000004")),
    ]:
        try:
            operation()
        except (ValueError, ZeroDivisionError) as error:
            controls.append({"id": identifier, "oracleException": type(error).__name__, "engineDiagnostic": diagnostic})
        else:
            raise AssertionError(f"negative control passed: {identifier}")
    return {"rounding": rounding, "scalarOperations": scalar, "weightedFlows": weighted_flows, "monthlyNormalization": flows, "assets": assets, "negativeControls": controls}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    contract = root / "docs" / "adr" / "0002-money-precision.md"
    with localcontext() as context:
        context.prec = 100
        cases = references()
    report = {
        "kind": "unapproved-precision-design-reference",
        "status": "PASS",
        "productAcceptance": False,
        "precisionProposal": "fixed12-money2-half-even-v1",
        "contractSha256": hashlib.sha256(contract.read_bytes()).hexdigest(),
        "oracle": "exact Fraction quotient/remainder versus Decimal(precision=100, ROUND_HALF_EVEN)",
        **cases,
    }
    with arguments.output.open("x", encoding="utf-8", newline="\n") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    print(f"Draft reference PASS: {len(cases['assets'])} asset cases, {sum(len(case['samples']) for case in cases['assets'])} exact monthly samples; product acceptance remains pending.")


if __name__ == "__main__":
    main()
