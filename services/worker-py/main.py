import os
import re
import sys
import zipfile
import io
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, UploadFile, File
from pydantic import BaseModel
import sympy
from sympy.parsing.sympy_parser import parse_expr, standard_transformations, implicit_multiplication_application
import defusedxml.ElementTree as ET

app = FastAPI(title="EduAssess Python Worker (CAS & Ingestion)")

# ====================================================================
# 1. Computer Algebra System (CAS) Algebraic Equivalence (§7.3 ADR-06)
# ====================================================================

class CasVerifyRequest(BaseModel):
    studentExpression: str
    expectedExpression: str
    variables: Optional[List[str]] = None

class CasVerifyResponse(BaseModel):
    isEquivalent: bool
    method: str
    difference: str
    confidence: float
    message: Optional[str] = None

# Transformasi parsing aman: perkalian implisit (misal 2x -> 2*x, (x+1)(x-1) -> (x+1)*(x-1))
SAFE_TRANSFORMATIONS = standard_transformations + (implicit_multiplication_application,)

def clean_expr_string(s: str) -> str:
    """Membersihkan notasi pangkat dan spasi dari input rumus"""
    s = s.strip()
    # Ganti ^ dengan ** untuk pangkat Python
    s = s.replace('^', '**')
    # Hilangkan backslash rumus latex sederhana bila ada (\frac{a}{b} -> (a)/(b))
    s = re.sub(r'\\frac\{([^}]+)\}\{([^}]+)\}', r'((\1)/(\2))', s)
    s = re.sub(r'\\cdot', '*', s)
    s = re.sub(r'\\times', '*', s)
    return s

@app.post("/cas/verify-math", response_model=CasVerifyResponse)
async def verify_math_equivalence(req: CasVerifyRequest):
    raw_stu = clean_expr_string(req.studentExpression)
    raw_exp = clean_expr_string(req.expectedExpression)

    # Siapkan simbol variabel aman
    var_names = req.variables or ['x', 'y', 'z', 'a', 'b', 'c', 'n', 't', 'k']
    local_symbols = {v: sympy.Symbol(v) for v in var_names}

    try:
        # Parse ekspresi secara aman tanpa eval()
        expr_stu = parse_expr(raw_stu, local_dict=local_symbols, transformations=SAFE_TRANSFORMATIONS, evaluate=True)
        expr_exp = parse_expr(raw_exp, local_dict=local_symbols, transformations=SAFE_TRANSFORMATIONS, evaluate=True)
    except Exception as e:
        return CasVerifyResponse(
            isEquivalent=False,
            method="parse_error",
            difference="syntax_error",
            confidence=0.0,
            message=f"Gagal mem-parsing ekspresi matematika: {str(e)}"
        )

    # 1. Symbolic Simplification: simplify(A - B) == 0
    try:
        diff = sympy.simplify(expr_stu - expr_exp)
        if diff == 0:
            return CasVerifyResponse(
                isEquivalent=True,
                method="symbolic_zero",
                difference="0",
                confidence=1.0,
                message="Secara aljabar ekuivalen penuh (simplify difference = 0)."
            )
    except Exception:
        pass

    # 2. Numerical Spot Check (sampling 5 titik acak di domain aman)
    try:
        import random
        is_num_match = True
        symbols_present = list(expr_stu.free_symbols.union(expr_exp.free_symbols))

        for _ in range(5):
            substitutions = {sym: random.uniform(1.5, 9.5) for sym in symbols_present}
            val_stu = complex(expr_stu.evalf(subs=substitutions))
            val_exp = complex(expr_exp.evalf(subs=substitutions))

            if abs(val_stu - val_exp) > 1e-6:
                is_num_match = False
                break

        if is_num_match and len(symbols_present) > 0:
            return CasVerifyResponse(
                isEquivalent=True,
                method="numerical_sampling",
                difference=str(diff) if 'diff' in locals() else "~0",
                confidence=0.98,
                message="Ekuivalen pada verifikasi numerical spot check."
            )
    except Exception:
        pass

    diff_str = str(diff) if 'diff' in locals() else "non_zero"
    return CasVerifyResponse(
        isEquivalent=False,
        method="symbolic_difference",
        difference=diff_str,
        confidence=1.0,
        message="Rumus tidak ekuivalen."
    )


# ====================================================================
# 2. Ingestion Dokumen Word .docx (§10 ADR-10)
# ====================================================================

# Namespace OMML Word XML
W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
M_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"

def omml_to_latex(elem) -> str:
    """Mengonversi potongan elemen persamaan OMML Microsoft Word ke LaTeX sederhana"""
    tag = elem.tag
    if tag == f"{M_NS}f": # Fraction \frac{num}{den}
        num_elem = elem.find(f"{M_NS}num")
        den_elem = elem.find(f"{M_NS}den")
        num_str = "".join([t.text or "" for t in num_elem.iter(f"{M_NS}t")]) if num_elem is not None else ""
        den_str = "".join([t.text or "" for t in den_elem.iter(f"{M_NS}t")]) if den_elem is not None else ""
        return f"\\frac{{{num_str}}}{{{den_str}}}"
    elif tag == f"{M_NS}sSup": # Superscript x^y
        e_elem = elem.find(f"{M_NS}e")
        sup_elem = elem.find(f"{M_NS}sup")
        e_str = "".join([t.text or "" for t in e_elem.iter(f"{M_NS}t")]) if e_elem is not None else ""
        sup_str = "".join([t.text or "" for t in sup_elem.iter(f"{M_NS}t")]) if sup_elem is not None else ""
        return f"{e_str}^{{{sup_str}}}"
    elif tag == f"{M_NS}rad": # Radical \sqrt[deg]{e}
        deg_elem = elem.find(f"{M_NS}deg")
        e_elem = elem.find(f"{M_NS}e")
        e_str = "".join([t.text or "" for t in e_elem.iter(f"{M_NS}t")]) if e_elem is not None else ""
        deg_str = "".join([t.text or "" for t in deg_elem.iter(f"{M_NS}t")]) if deg_elem is not None else ""
        return f"\\sqrt[{deg_str}]{{{e_str}}}" if deg_str else f"\\sqrt{{{e_str}}}"
    else:
        # Default teks matematika
        texts = [t.text or "" for t in elem.iter(f"{M_NS}t")]
        return "".join(texts)

def extract_docx_paragraphs(file_bytes: bytes) -> List[str]:
    """Mengekstrak teks paragraf dan rumus matematika dari berkas docx XML"""
    paragraphs = []
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        if "word/document.xml" not in z.namelist():
            return []
        xml_content = z.read("word/document.xml")
        root = ET.fromstring(xml_content)

        for p in root.iter(f"{W_NS}p"):
            p_parts = []
            for child in p:
                if child.tag == f"{W_NS}r":
                    for t in child.iter(f"{W_NS}t"):
                        if t.text:
                            p_parts.append(t.text)
                elif child.tag == f"{M_NS}oMath":
                    math_latex = omml_to_latex(child)
                    if math_latex:
                        p_parts.append(f" ${math_latex}$ ")
            full_line = "".join(p_parts).strip()
            if full_line:
                paragraphs.append(full_line)
    return paragraphs

@app.post("/ingest/docx")
async def ingest_docx(file: UploadFile = File(...)):
    """Mem-parsing berkas .docx menjadi bank soal staging dengan anotasi anomali (§10 TDD)"""
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Ukuran berkas melebihi batas 25MB.")

    try:
        paragraphs = extract_docx_paragraphs(content)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal memproses arsip .docx: {str(e)}")

    questions = []
    current_q: Optional[Dict[str, Any]] = None

    q_num_pattern = re.compile(r'^(?:Soal\s*)?(\d+)[\.\)]\s*(.*)', re.IGNORECASE)
    opt_pattern = re.compile(r'^([A-E])[\.\)]\s*(.*)', re.IGNORECASE)
    key_pattern = re.compile(r'^(?:Kunci|Jawaban)\s*(?::|=)\s*([A-E])', re.IGNORECASE)

    for line in paragraphs:
        q_match = q_num_pattern.match(line)
        if q_match:
            if current_q:
                questions.append(current_q)
            num = q_match.group(1)
            stem = q_match.group(2)
            current_q = {
                "order": int(num),
                "stem": stem,
                "type": "single_choice",
                "options": [],
                "key": None,
                "flags": [],
            }
            continue

        if current_q:
            opt_match = opt_pattern.match(line)
            if opt_match:
                opt_id = opt_match.group(1).upper()
                opt_text = opt_match.group(2)
                current_q["options"].append({"id": opt_id, "text": opt_text})
                continue

            k_match = key_pattern.match(line)
            if k_match:
                current_q["key"] = k_match.group(1).upper()
                continue

            # Sambungan teks pokok soal
            current_q["stem"] += " " + line

    if current_q:
        questions.append(current_q)

    # Validasi dan penandaan anomali (§10.3)
    arabic_pattern = re.compile(r'[\u0600-\u06FF]')
    for q in questions:
        if not q["key"]:
            q["flags"].append("key_missing")
        if len(q["options"]) < 2:
            q["flags"].append("insufficient_options")
        if arabic_pattern.search(q["stem"]):
            q["flags"].append("arabic_content")

    return {
        "filename": file.filename,
        "totalExtracted": len(questions),
        "questions": questions,
    }


# ====================================================================
# Health check endpoint
# ====================================================================

@app.get("/healthz")
async def health():
    return {"status": "ok", "service": "worker-py", "sympy_version": sympy.__version__}

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
