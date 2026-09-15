#!/usr/bin/env python3
"""Сверка: какие объекты из каждой миграции реально существуют в БД.

Нужна перед baseline на живой базе без журнала: указать baseline наугад —
единственный способ потерять данные (миграция выполнится повторно поверх).
Скрипт парсит CREATE TABLE / ADD COLUMN из каждого файла и проверяет наличие
в целевой БД, чтобы baseline ставился по фактам, а не по памяти.

Запуск: python3 scripts/check-migration-state.py <docker-container>
"""
import re
import subprocess
import sys
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent / "database" / "migrations"


def psql(container: str, sql: str) -> str:
    out = subprocess.run(
        ["docker", "exec", container, "psql", "-U", "samaya", "-d", "samaya", "-tAc", sql],
        capture_output=True, text=True,
    )
    return out.stdout.strip()


def parse(path: Path):
    """→ (таблицы, колонки) с учётом SET search_path для неквалифицированных имён.

    ALTER TABLE ... ADD COLUMN разнесён по строкам, поэтому имя таблицы
    запоминается отдельно от колонок, а сам разбор идёт по всему тексту:
    построчные regex спотыкались о хвосты вроде `reminder_sent_at TIMESTAMPTZ,`.
    """
    text = path.read_text(encoding="utf-8")
    tables, columns = [], []
    schema = "public"
    cur_table = None
    for line in text.splitlines():
        line = line.split("--", 1)[0]
        m = re.match(r"\s*SET\s+search_path\s+TO\s+([a-z_]+)", line, re.I)
        if m:
            schema = m.group(1)
            continue
        m = re.match(r"\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_.]*)", line, re.I)
        if m:
            name = m.group(1)
            tables.append(name if "." in name else f"{schema}.{name}")
            cur_table = None
            continue
        m = re.match(r"\s*ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z_.]*)", line, re.I)
        if m:
            name = m.group(1)
            cur_table = name if "." in name else f"{schema}.{name}"
            continue
        m = re.match(r"\s*ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z_0-9]*)", line, re.I)
        if m and cur_table:
            columns.append((cur_table, m.group(1)))
    return tables, columns


def main():
    container = sys.argv[1] if len(sys.argv) > 1 else "prod-copy"
    files = sorted(MIGRATIONS.glob("*.sql"))
    last_fully_applied, first_missing = None, None

    for f in files:
        tables, columns = parse(f)
        missing = []
        for t in tables:
            if psql(container, f"SELECT to_regclass('{t}')") == "":
                missing.append(f"table {t}")
        for tbl, col in columns:
            if "." not in tbl:
                continue
            sch, name = tbl.split(".", 1)
            q = (f"SELECT 1 FROM information_schema.columns WHERE table_schema='{sch}' "
                 f"AND table_name='{name}' AND column_name='{col}'")
            if psql(container, q) != "1":
                missing.append(f"column {tbl}.{col}")
        checked = len(tables) + len(columns)
        if missing:
            status = f"ОТСУТСТВУЕТ: {', '.join(missing[:3])}"
            if first_missing is None:
                first_missing = f.name
        elif checked == 0:
            status = "нечего проверять (только данные/индексы)"
        else:
            status = f"применена (проверено объектов: {checked})"
            if first_missing is None:
                last_fully_applied = f.name
        print(f"{f.name:42} {status}")

    print()
    print(f"Последняя подтверждённо применённая: {last_fully_applied}")
    print(f"Первая с пропусками:                 {first_missing or '— нет, БД актуальна'}")
    if first_missing is None:
        print("\nВывод: MIGRATE_BASELINE=all безопасен.")
    else:
        print(f"\nВывод: baseline ставить по {last_fully_applied}, "
              f"остальное migrator накатит сам.")


if __name__ == "__main__":
    main()
