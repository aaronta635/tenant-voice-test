"""Evaluate the SQL of the shared catalog's CHECK constraints and unique indexes on a row.

The strict fake (tests/fake_supabase.py) enforces the rules in
app/db/shared_catalog.json, whose expressions are as Postgres prints them
(pg_get_constraintdef, pg_indexes). This reads the shapes they use, with SQL's
three-valued logic (None is NULL):

- column references, string and number literals, NULL, TRUE, FALSE, ARRAY[...];
- casts (::text, ::numeric, ::integer, ::date, ::uuid, ::jsonb, ...; a quoted
  type such as ::"ApplicationStatus" is an enum and stays text);
- AND, OR, NOT; IS [NOT] NULL / TRUE / FALSE / DISTINCT FROM;
- = <> < <= > >=, also as "op ANY (array)" and "op ALL (array)" (= ANY, <> ALL);
- [NOT] IN (...), [NOT] BETWEEN, LIKE / ILIKE and ~~ / ~~*, regex ~ ~* !~ !~*;
- ||, ->, ->>, + - * / %;
- length, char_length, lower, upper, btrim, ltrim, rtrim, TRIM(... FROM ...),
  COALESCE, NULLIF and split_part.

Anything else raises SqlUnreadable when the expression is compiled, never a
silent pass: tests/test_fake_catalog_rules.py compiles every rule of the
snapshot. Values are read as their column's type (the shared schema's
formats), so numbers, dates, timestamps and uuids compare as Postgres
compares them; a value the type cannot hold raises SqlValueError (22P02).
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from functools import lru_cache


class SqlUnreadable(ValueError):
    """An expression or value the fake cannot evaluate: teach this module the shape rather than skip the rule."""


class SqlValueError(ValueError):
    """A value its column's type cannot hold: Postgres refuses it with 22P02."""

    def __init__(self, sql_type: str, value):
        super().__init__(f'invalid input syntax for type {sql_type}: "{value}"')
        self.sql_type = sql_type
        self.value = value


# -- values -------------------------------------------------------------------
_INTEGER_TYPES = {"int32", "int64", "integer", "int", "int4", "bigint", "int8", "smallint", "int2"}
_TEXT_TYPES = {"text", "character varying", "varchar", "character", "char", "bpchar", "name"}
_TIMESTAMP_TYPES = {"timestamp with time zone", "timestamptz", "timestamp without time zone", "timestamp"}


def _kind(sql_type: str | None) -> str | None:
    """What a column's type reads as: uuid, text, integer, numeric, boolean, date, timestamp, json or array."""
    if sql_type is None:
        return None
    lowered = sql_type.lower()
    if lowered.endswith("[]"):
        return "array"
    if lowered in _INTEGER_TYPES:
        return "integer"
    if lowered.startswith("numeric") or lowered in ("decimal", "real", "double precision", "float4", "float8"):
        return "numeric"
    if lowered in ("boolean", "bool"):
        return "boolean"
    if lowered == "date":
        return "date"
    if lowered in _TIMESTAMP_TYPES:
        return "timestamp"
    if lowered in ("json", "jsonb"):
        return "json"
    if lowered == "uuid":
        return "uuid"
    if lowered in _TEXT_TYPES or lowered.startswith(("character varying", "varchar")) or '"' in sql_type:
        return "text"  # a quoted type is an enum: its labels compare as text
    return None


def _json_text(value) -> str:
    """A JSON value as jsonb prints it."""
    return json.dumps(value, ensure_ascii=False)


def _timestamp(value) -> datetime:
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, date):
        moment = datetime.combine(value, time())
    else:
        moment = datetime.fromisoformat(str(value).strip())
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)  # the database runs in UTC


def to_type(value, sql_type: str | None):
    """value as Postgres holds it in a column of sql_type; None stays None.

    A type this module does not know leaves the value as it is.
    """
    if value is None:
        return None
    kind = _kind(sql_type)
    try:
        if kind == "uuid":
            return str(uuid.UUID(str(value)))
        if kind == "text":
            return value if isinstance(value, str) else _json_text(value)
        if kind == "integer":
            if isinstance(value, bool):
                raise ValueError
            number = Decimal(str(value).strip())
            if number != number.to_integral_value():
                raise ValueError
            return int(number)
        if kind == "numeric":
            if isinstance(value, bool):
                raise ValueError
            number = Decimal(str(value).strip())
            if not number.is_finite():
                raise ValueError
            return number
        if kind == "boolean":
            if isinstance(value, bool):
                return value
            lowered = str(value).strip().lower()
            if lowered in ("true", "t", "yes", "on", "1"):
                return True
            if lowered in ("false", "f", "no", "off", "0"):
                return False
            raise ValueError
        if kind == "date":
            if isinstance(value, datetime):
                return value.date()
            if isinstance(value, date):
                return value
            return date.fromisoformat(str(value).strip()[:10])
        if kind == "timestamp":
            return _timestamp(value)
    except (ValueError, InvalidOperation, TypeError):
        raise SqlValueError(sql_type or "unknown", value) from None
    return value


def to_text(value) -> str | None:
    """value::text."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, datetime):
        moment = value.astimezone(timezone.utc)
        fraction = f".{moment.microsecond:06d}".rstrip("0") if moment.microsecond else ""
        return moment.strftime("%Y-%m-%d %H:%M:%S") + fraction + "+00"
    if isinstance(value, date):
        return value.isoformat()
    return _json_text(value)


def _comparable(left, right):
    """left and right as one type, as Postgres would compare them."""
    if isinstance(left, bool) or isinstance(right, bool):
        if isinstance(left, bool) and isinstance(right, bool):
            return left, right
    elif isinstance(left, (int, float, Decimal)) or isinstance(right, (int, float, Decimal)):
        try:
            return (Decimal(str(left)), Decimal(str(right)))
        except InvalidOperation:
            pass
    elif isinstance(left, (date, datetime)) or isinstance(right, (date, datetime)):
        if type(left) is date and type(right) is date:
            return left, right
        try:
            return _timestamp(left), _timestamp(right)
        except (TypeError, ValueError):
            pass
    elif isinstance(left, str) and isinstance(right, str):
        return left, right
    elif isinstance(left, (dict, list)) and isinstance(right, (dict, list)):
        return _json_text(left), _json_text(right)
    raise SqlUnreadable(f"the fake does not compare {left!r} with {right!r}")


def equal(left, right) -> bool | None:
    """left = right, with NULL as unknown."""
    if left is None or right is None:
        return None
    left, right = _comparable(left, right)
    return left == right


_COMPARISONS = {
    "<": lambda order: order < 0,
    "<=": lambda order: order <= 0,
    ">": lambda order: order > 0,
    ">=": lambda order: order >= 0,
}


def _compare(op: str, left, right) -> bool | None:
    if left is None or right is None:
        return None
    left, right = _comparable(left, right)
    if op in ("=", "<>", "!="):
        return (left == right) == (op == "=")
    return _COMPARISONS[op]((left > right) - (left < right))


def distinct(left, right) -> bool:
    """left IS DISTINCT FROM right: NULL is a value here."""
    if left is None or right is None:
        return (left is None) != (right is None)
    return not equal(left, right)


def _and(values) -> bool | None:
    result = True
    for value in values:
        if value is False:
            return False
        if value is None:
            result = None
    return result


def _or(values) -> bool | None:
    result = False
    for value in values:
        if value is True:
            return True
        if value is None:
            result = None
    return result


def _python_regex(pattern: str) -> str:
    """A Postgres regular expression as Python reads it: $ only at the very end, . across newlines (DOTALL)."""
    out, index, in_class = [], 0, False
    while index < len(pattern):
        char = pattern[index]
        if char == "\\":
            escaped = pattern[index + 1:index + 2]
            if escaped in ("m", "M", "y", "Y", "A", "Z", "<", ">") or not escaped:
                raise SqlUnreadable(f"the fake does not read the regex escape \\{escaped} in {pattern!r}")
            out.append(pattern[index:index + 2])
            index += 2
            continue
        if in_class:
            if pattern.startswith(("[:", "[=", "[."), index):
                raise SqlUnreadable(f"the fake does not read bracket classes such as [: :] in {pattern!r}")
            if char == "]":
                in_class = False
            out.append(char)
        elif char == "[":
            in_class = True
            out.append(char)
            index += 1
            if pattern.startswith("^", index):
                out.append("^")
                index += 1
            if pattern.startswith("]", index):  # a ] first in a class is itself
                out.append("\\]")
                index += 1
            continue
        elif char == "$":
            out.append(r"\Z")
        else:
            out.append(char)
        index += 1
    return "".join(out)


@lru_cache(maxsize=None)
def _regex(pattern: str, ignore_case: bool) -> re.Pattern:
    return re.compile(_python_regex(pattern), re.DOTALL | (re.IGNORECASE if ignore_case else 0))


@lru_cache(maxsize=None)
def _like(pattern: str, ignore_case: bool) -> re.Pattern:
    """A LIKE pattern: % any run, _ one character, \\ escapes the next."""
    out, index = [], 0
    while index < len(pattern):
        char = pattern[index]
        if char == "\\" and index + 1 < len(pattern):
            out.append(re.escape(pattern[index + 1]))
            index += 2
            continue
        out.append(".*" if char == "%" else "." if char == "_" else re.escape(char))
        index += 1
    return re.compile("".join(out), re.DOTALL | (re.IGNORECASE if ignore_case else 0))


def _matches(op: str, value, pattern) -> bool | None:
    if value is None or pattern is None:
        return None
    text, pattern = to_text(value), to_text(pattern)
    negate = op.startswith("!")
    core = op.lstrip("!")
    if core in ("~", "~*"):
        found = _regex(pattern, core == "~*").search(text) is not None
    else:  # ~~ (LIKE) and ~~* (ILIKE)
        found = _like(pattern, core == "~~*").fullmatch(text) is not None
    return not found if negate else found


def _json_get(op: str, document, key):
    if document is None or key is None:
        return None
    if isinstance(document, dict):
        value = document.get(to_text(key))
    elif isinstance(document, list) and isinstance(key, int):
        value = document[key] if -len(document) <= key < len(document) else None
    else:
        return None
    if op == "->>":
        return None if value is None else value if isinstance(value, str) else _json_text(value)
    return value


def _arithmetic(op: str, left, right):
    if left is None or right is None:
        return None
    if not all(isinstance(v, (int, Decimal)) and not isinstance(v, bool) for v in (left, right)):
        raise SqlUnreadable(f"the fake does only number arithmetic, not {left!r} {op} {right!r}")
    if op == "+":
        return left + right
    if op == "-":
        return left - right
    if op == "*":
        return left * right
    if right == 0:
        raise SqlValueError("numeric", "division by zero")
    if op == "/":
        return left // right if isinstance(left, int) and isinstance(right, int) else Decimal(left) / Decimal(right)
    return left % right


def _binary(op: str, left, right):
    if op == "||":
        if left is None or right is None:
            return None
        if isinstance(left, list) or isinstance(right, list):
            raise SqlUnreadable("the fake does not join arrays with ||")
        return to_text(left) + to_text(right)
    if op in ("->", "->>"):
        return _json_get(op, left, right)
    if op in ("+", "-", "*", "/", "%"):
        return _arithmetic(op, left, right)
    return _matches(op, left, right)


# -- functions ------------------------------------------------------------------
def _trim(value, characters, leading: bool, trailing: bool):
    if value is None or characters is None:
        return None
    text, characters = to_text(value), to_text(characters)
    if leading:
        text = text.lstrip(characters)
    if trailing:
        text = text.rstrip(characters)
    return text


def _split_part(value, delimiter, field):
    if value is None or delimiter is None or field is None:
        return None
    text, delimiter, field = to_text(value), to_text(delimiter), int(field)
    if field == 0:
        raise SqlValueError("integer", "field position must not be zero")
    parts = text.split(delimiter) if delimiter else [text]
    index = field - 1 if field > 0 else len(parts) + field
    return parts[index] if 0 <= index < len(parts) else ""


def _length(value):
    return None if value is None else len(to_text(value))


def _case(change):
    return lambda value: None if value is None else change(to_text(value))


def _coalesce(*values):
    return next((value for value in values if value is not None), None)


def _nullif(left, right):
    return None if left is not None and equal(left, right) else left


_FUNCTIONS: dict[str, tuple[int, int | None, Callable]] = {  # name -> (fewest, most arguments, function)
    "length": (1, 1, _length),
    "char_length": (1, 1, _length),
    "character_length": (1, 1, _length),
    "lower": (1, 1, _case(str.lower)),
    "upper": (1, 1, _case(str.upper)),
    "btrim": (1, 2, lambda value, characters=" ": _trim(value, characters, True, True)),
    "ltrim": (1, 2, lambda value, characters=" ": _trim(value, characters, True, False)),
    "rtrim": (1, 2, lambda value, characters=" ": _trim(value, characters, False, True)),
    "coalesce": (1, None, _coalesce),
    "nullif": (2, 2, _nullif),
    "split_part": (3, 3, _split_part),
}

# SQL words that are never a column: a rule using one needs teaching here.
_RESERVED = {"select", "from", "where", "case", "when", "then", "else", "end", "exists", "current_date",
             "current_timestamp", "current_time", "localtime", "localtimestamp", "current_user", "session_user",
             "interval", "collate", "similar", "overlaps", "and", "or", "not", "is", "in", "like", "ilike",
             "between", "any", "all", "some", "array"}


# -- casts ----------------------------------------------------------------------
def _round_integer(value) -> int:
    """value::integer: numeric rounds half away from zero, text must be a whole number."""
    try:
        number = Decimal(str(value).strip())
        if isinstance(value, str) and number != number.to_integral_value():
            raise InvalidOperation
        return int(number.quantize(Decimal(1), rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError):
        raise SqlValueError("integer", value) from None


def _cast(type_name: str, quoted: bool) -> Callable:
    """The cast to type_name; a quoted type is an enum, whose labels stay text."""
    if quoted:
        return lambda value: None if value is None else to_text(value)
    lowered = type_name.lower()
    if lowered.endswith("[]"):
        def to_array(value):
            if value is None or isinstance(value, list):
                return value
            raise SqlUnreadable(f"the fake does not cast {value!r} to {type_name}")
        return to_array
    kind = _kind(lowered)
    if kind == "text":
        return to_text
    if kind == "integer":
        return lambda value: None if value is None else _round_integer(value)
    if kind == "numeric":
        return lambda value: to_type(value, "numeric")
    if kind in ("boolean", "date", "timestamp", "uuid"):
        return lambda value: to_type(value, lowered)
    if kind == "json":
        return lambda value: json.loads(value) if isinstance(value, str) else value
    raise SqlUnreadable(f"the fake does not cast to {type_name}")


# -- parsing ----------------------------------------------------------------------
_TOKEN = re.compile(r"""
    (?P<space>\s+)
  | (?P<string>'(?:[^']|'')*')
  | (?P<quoted>"(?:[^"]|"")+")
  | (?P<number>\d+(?:\.\d+)?|\.\d+)
  | (?P<op>::|->>|->|\|\||<=|>=|<>|!=|!~~\*|!~~|~~\*|~~|!~\*|!~|~\*|~|=|<|>|\+|-|\*|/|%|\(|\)|\[|\]|,|\.)
  | (?P<word>[A-Za-z_][A-Za-z0-9_$]*)
""", re.X)


@dataclass(frozen=True)
class _Token:
    kind: str
    text: str

    @property
    def lower(self) -> str:
        return self.text.lower()


def _tokenize(text: str) -> list[_Token]:
    tokens, index = [], 0
    while index < len(text):
        match = _TOKEN.match(text, index)
        if match is None:
            raise SqlUnreadable(f"the fake cannot read {text[index:index + 20]!r} in {text!r}")
        if match.lastgroup != "space":
            tokens.append(_Token(match.lastgroup, match.group()))
        index = match.end()
    return tokens


class _Env:
    """A row as an expression reads it: each column as its type holds it."""

    __slots__ = ("row", "types")

    def __init__(self, row: dict, types: dict[str, str]):
        self.row = row
        self.types = types

    def column(self, name: str):
        return to_type(self.row.get(name), self.types.get(name))


_COMPARISON_OPS = ("=", "<>", "!=", "<", "<=", ">", ">=")
_OTHER_OPS = ("||", "->>", "->", "~", "~*", "!~", "!~*", "~~", "~~*", "!~~", "!~~*")


class _Parser:
    """Recursive descent over Postgres's operator precedence; each rule returns a function of the row."""

    def __init__(self, text: str):
        self.text = text
        self.tokens = _tokenize(text)
        self.position = 0
        self.columns: set[str] = set()

    # -- tokens
    def _peek(self, offset: int = 0) -> _Token | None:
        index = self.position + offset
        return self.tokens[index] if index < len(self.tokens) else None

    def _is_word(self, *words: str, offset: int = 0) -> bool:
        token = self._peek(offset)
        return token is not None and token.kind == "word" and token.lower in words

    def _is_op(self, *ops: str, offset: int = 0) -> bool:
        token = self._peek(offset)
        return token is not None and token.kind == "op" and token.text in ops

    def _take(self) -> _Token:
        token = self._peek()
        if token is None:
            raise self._unreadable("the expression ends too soon")
        self.position += 1
        return token

    def _expect_op(self, op: str) -> None:
        if not self._is_op(op):
            raise self._unreadable(f"expected {op!r}")
        self.position += 1

    def _expect_word(self, word: str) -> None:
        if not self._is_word(word):
            raise self._unreadable(f"expected {word.upper()}")
        self.position += 1

    def _unreadable(self, why: str) -> SqlUnreadable:
        token = self._peek()
        where = f" at {token.text!r}" if token else ""
        return SqlUnreadable(f"the fake cannot read {self.text!r}: {why}{where}")

    def finish(self) -> None:
        if self._peek() is not None:
            raise self._unreadable("unexpected text")

    # -- grammar, loosest first
    def expression(self):
        parts = [self._and()]
        while self._is_word("or"):
            self.position += 1
            parts.append(self._and())
        if len(parts) == 1:
            return parts[0]
        return lambda env: _or(part(env) for part in parts)

    def _and(self):
        parts = [self._not()]
        while self._is_word("and"):
            self.position += 1
            parts.append(self._not())
        if len(parts) == 1:
            return parts[0]
        return lambda env: _and(part(env) for part in parts)

    def _not(self):
        if self._is_word("not"):
            self.position += 1
            inner = self._not()
            return lambda env: (lambda value: None if value is None else not value)(inner(env))
        return self._is()

    def _is(self):
        node = self._comparison()
        while True:
            if self._is_word("isnull", "notnull"):
                wanted = self._take().lower == "isnull"
                node = (lambda inner, wanted: lambda env: (inner(env) is None) == wanted)(node, wanted)
            elif self._is_word("is"):
                self.position += 1
                negate = self._is_word("not")
                if negate:
                    self.position += 1
                if self._is_word("null"):
                    self.position += 1
                    test = (lambda inner: lambda env: inner(env) is None)(node)
                elif self._is_word("true", "false"):
                    wanted = self._take().lower == "true"
                    test = (lambda inner, wanted: lambda env: inner(env) is wanted)(node, wanted)
                elif self._is_word("unknown"):
                    self.position += 1
                    test = (lambda inner: lambda env: inner(env) is None)(node)
                elif self._is_word("distinct"):
                    self.position += 1
                    self._expect_word("from")
                    other = self._comparison()
                    test = (lambda inner, other: lambda env: distinct(inner(env), other(env)))(node, other)
                else:
                    raise self._unreadable("expected NULL, TRUE, FALSE, UNKNOWN or DISTINCT FROM after IS")
                node = (lambda test, negate: lambda env: test(env) != negate)(test, negate)
            else:
                return node

    def _quantified(self, left, op: str):
        """left op ANY (array) or left op ALL (array)."""
        mode = self._take().lower
        self._expect_op("(")
        array = self.expression()
        self._expect_op(")")
        test = (lambda value, item: _compare(op, value, item)) if op in _COMPARISON_OPS else (
            lambda value, item: _binary(op, value, item))

        def evaluate(env):
            value, items = left(env), array(env)
            if items is None:
                return None
            if not isinstance(items, list):
                raise SqlUnreadable(f"{op} {mode.upper()} needs an array, not {items!r}")
            results = [test(value, item) for item in items]
            return _or(results) if mode in ("any", "some") else _and(results)

        return evaluate

    def _comparison(self):
        left = self._pattern()
        if self._is_op(*_COMPARISON_OPS):
            op = self._take().text
            if self._is_word("any", "some", "all"):
                return self._quantified(left, op)
            right = self._pattern()
            return lambda env: _compare(op, left(env), right(env))
        return left

    def _pattern(self):
        """IN, BETWEEN, LIKE and ILIKE, which bind tighter than comparisons."""
        left = self._other()
        negate = self._is_word("not") and self._is_word("in", "between", "like", "ilike", offset=1)
        if negate:
            self.position += 1
        if self._is_word("in"):
            self.position += 1
            self._expect_op("(")
            items = [self.expression()]
            while self._is_op(","):
                self.position += 1
                items.append(self.expression())
            self._expect_op(")")

            def within(env):
                value = left(env)
                return _or(_compare("=", value, item(env)) for item in items)
            node = within
        elif self._is_word("between"):
            self.position += 1
            low = self._other()
            self._expect_word("and")
            high = self._other()

            def between(env):
                value = left(env)
                return _and((_compare(">=", value, low(env)), _compare("<=", value, high(env))))
            node = between
        elif self._is_word("like", "ilike"):
            op = "~~" if self._take().lower == "like" else "~~*"
            right = self._other()
            node = (lambda op, right: lambda env: _matches(op, left(env), right(env)))(op, right)
        else:
            return left
        if negate:
            return lambda env: (lambda value: None if value is None else not value)(node(env))
        return node

    def _other(self):
        left = self._additive()
        while self._is_op(*_OTHER_OPS):
            op = self._take().text
            if self._is_word("any", "some", "all"):
                left = self._quantified(left, op)
                continue
            right = self._additive()
            if op.lstrip("!") in ("~", "~*") and isinstance(getattr(right, "literal", None), str):
                _regex(right.literal, op.endswith("*"))  # an unreadable pattern fails here, not at a write
            left = (lambda op, left, right: lambda env: _binary(op, left(env), right(env)))(op, left, right)
        return left

    def _additive(self):
        left = self._multiplicative()
        while self._is_op("+", "-"):
            op = self._take().text
            right = self._multiplicative()
            left = (lambda op, left, right: lambda env: _arithmetic(op, left(env), right(env)))(op, left, right)
        return left

    def _multiplicative(self):
        left = self._unary()
        while self._is_op("*", "/", "%"):
            op = self._take().text
            right = self._unary()
            left = (lambda op, left, right: lambda env: _arithmetic(op, left(env), right(env)))(op, left, right)
        return left

    def _unary(self):
        if self._is_op("-"):
            self.position += 1
            inner = self._unary()
            return lambda env: (lambda value: None if value is None else _arithmetic("-", 0, value))(inner(env))
        if self._is_op("+"):
            self.position += 1
            return self._unary()
        return self._postfix()

    def _postfix(self):
        node = self._primary()
        while True:
            if self._is_op("::"):
                self.position += 1
                cast, literal = self._type(), getattr(node, "literal", None)
                node = (lambda cast, inner: lambda env: cast(inner(env)))(cast, node)
                if literal is not None:  # 'x'::text is still the literal 'x'
                    node.literal = literal
            elif self._is_op("["):
                self.position += 1
                index = self.expression()
                self._expect_op("]")

                def element(env, inner=node, index=index):
                    items, position = inner(env), index(env)
                    if items is None or position is None:
                        return None
                    position = int(position)  # SQL arrays count from 1
                    return items[position - 1] if 1 <= position <= len(items) else None
                node = element
            else:
                return node

    def _type(self) -> Callable:
        token = self._take()
        if token.kind == "quoted":
            name, quoted = token.text[1:-1].replace('""', '"'), True
        elif token.kind == "word":
            name, quoted = token.lower, False
        else:
            raise self._unreadable("expected a type name")
        if self._is_op("."):  # schema-qualified: public."ListingStatus"
            self.position += 1
            token = self._take()
            name, quoted = (token.text[1:-1], True) if token.kind == "quoted" else (token.lower, quoted)
        if not quoted:
            if name == "timestamp" and self._is_word("with", "without"):
                name += " " + " ".join(self._take().lower for _ in range(3))  # with time zone
            elif name == "character" and self._is_word("varying"):
                name += " " + self._take().lower
            elif name == "double" and self._is_word("precision"):
                name += " " + self._take().lower
            if self._is_op("("):  # numeric(10,2), character varying(255)
                while not self._is_op(")"):
                    self._take()
                self.position += 1
        if self._is_op("[") and self._is_op("]", offset=1):
            self.position += 2
            name += "[]"
        return _cast(name, quoted)

    def _list(self, close: str) -> list:
        items = []
        if not self._is_op(close):
            items.append(self.expression())
            while self._is_op(","):
                self.position += 1
                items.append(self.expression())
        self._expect_op(close)
        return items

    def _column(self, name: str):
        self.columns.add(name)
        return lambda env: env.column(name)

    def _primary(self):
        token = self._take()
        if token.kind == "string":
            value = token.text[1:-1].replace("''", "'")

            def literal(env):
                return value
            literal.literal = value  # what a regex operator checks when the rule compiles
            return literal
        if token.kind == "number":
            value = Decimal(token.text) if "." in token.text else int(token.text)
            return lambda env: value
        if token.kind == "op" and token.text == "(":
            node = self.expression()
            self._expect_op(")")
            return node
        if token.kind == "quoted":
            name = token.text[1:-1].replace('""', '"')
            if self._is_op("."):  # "table"."column"
                self.position += 1
                return self._primary()
            return self._column(name)
        if token.kind != "word":
            raise self._unreadable(f"unexpected {token.text!r}")
        word = token.lower
        if word == "null":
            return lambda env: None
        if word in ("true", "false"):
            value = word == "true"
            return lambda env: value
        if word == "array":
            self._expect_op("[")
            items = self._list("]")
            return lambda env: [item(env) for item in items]
        if word == "trim" and self._is_op("("):
            return self._trim()
        if self._is_op("("):
            if word not in _FUNCTIONS:
                raise SqlUnreadable(f"the fake does not evaluate the function {token.text}() in {self.text!r}")
            fewest, most, function = _FUNCTIONS[word]
            self.position += 1
            arguments = self._list(")")
            if len(arguments) < fewest or (most is not None and len(arguments) > most):
                raise self._unreadable(f"{token.text}() takes {fewest} to {most or 'any'} arguments")
            return lambda env: function(*(argument(env) for argument in arguments))
        if word in _RESERVED:
            raise SqlUnreadable(f"the fake does not evaluate {token.text.upper()} in {self.text!r}")
        if self._is_op(".") and self._peek(1) is not None and self._peek(1).kind in ("word", "quoted"):
            self.position += 1  # table.column: the row is the table's
            return self._primary()
        return self._column(token.text)  # Postgres prints a name that needs quoting with its quotes

    def _trim(self):
        """TRIM([BOTH | LEADING | TRAILING] [characters] FROM value), or TRIM(value)."""
        self._expect_op("(")
        side = "both"
        if self._is_word("both", "leading", "trailing"):
            side = self._take().lower
        if self._is_word("from"):
            self.position += 1
            characters, value = (lambda env: " "), self.expression()
        else:
            first = self.expression()
            if self._is_word("from"):
                self.position += 1
                characters, value = first, self.expression()
            else:
                characters, value = (lambda env: " "), first
        self._expect_op(")")
        leading, trailing = side in ("both", "leading"), side in ("both", "trailing")
        return lambda env: _trim(value(env), characters(env), leading, trailing)


@dataclass(frozen=True)
class Expression:
    """A compiled expression: call it with a row and its column types for True, False or None (NULL).

    A CHECK passes unless it is False; a partial index's WHERE takes a row only when it is True.
    """

    text: str
    columns: frozenset[str]
    _evaluate: Callable

    def __call__(self, row: dict, types: dict[str, str] | None = None):
        return self._evaluate(_Env(row, types or {}))


@lru_cache(maxsize=None)
def compile_expression(text: str) -> Expression:
    """text compiled once, or SqlUnreadable naming the part the fake cannot read."""
    parser = _Parser(text)
    node = parser.expression()
    parser.finish()
    return Expression(text, frozenset(parser.columns), node)
