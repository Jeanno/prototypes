"""Builds words.js: English words with frequency rank, definition and usage example.

Run: TATOEBA=path/to/eng_sentences.tsv IPA_UK=path/to/en_UK.txt uv run --python 3.12 --with wordfreq --with nltk vocab/build_words.py
Sources: WordNet 3.0 (Princeton, WordNet license), wordfreq (CC BY-SA 4.0),
Tatoeba eng_sentences.tsv (CC BY 2.0 FR, https://downloads.tatoeba.org/exports/per_language/eng/),
CMUdict (BSD) for US IPA, ipa-dict en_UK (MIT, https://github.com/open-dict-data/ipa-dict) for UK IPA.
"""
import json
import os
import re
import sys

import nltk
from wordfreq import top_n_list, zipf_frequency

NLTK_DIR = os.environ.get("NLTK_DATA", os.path.join(os.path.dirname(__file__), ".nltk"))
nltk.download("wordnet", download_dir=NLTK_DIR, quiet=True)
nltk.download("cmudict", download_dir=NLTK_DIR, quiet=True)
nltk.data.path.insert(0, NLTK_DIR)
from nltk.corpus import cmudict, wordnet as wn  # noqa: E402

MIN_ZIPF = 2.3
POS = {"n": "noun", "v": "verb", "a": "adjective", "s": "adjective", "r": "adverb"}
BLOCK = set("""
fuck fucking shit bitch cunt dick cock pussy whore slut nigger nigga faggot fag retard bastard
asshole piss tits boob boobs porn rape rapist cum dildo wank twat bollocks crap damn sex sexy
""".split())


def senses(w):
    """Common-noun/verb/adj senses whose lemma is exactly w (drops proper nouns like 'London')."""
    syns = [s for s in wn.synsets(w) if not s.instance_hypernyms() and any(l.name() == w for l in s.lemmas())]
    # WordNet lists nouns before adjectives; SemCor usage counts give the real most-common sense.
    # Domain-labelled senses ("(chemistry) ...") rarely match everyday example sentences.
    return sorted(syns, key=lambda s: -sum(l.count() for l in s.lemmas() if l.name() == w) + (3 if s.definition().startswith("(") else 0))


def is_base(w):
    """Drops inflections ("taken", "words") whose base form is at least as common."""
    if not any(wn.morphy(w, p) == w for p in "nvar"):
        return False
    z = zipf_frequency(w, "en")
    for p in "nv":
        for b in set(wn._morphy(w, p)) - {w}:
            if zipf_frequency(b, "en") >= z:
                return False
    return True


def forms(w, pos="v"):
    if pos in "asr":
        return {w}
    out = {w, w + "s", w + "es"} | ({w[:-1] + "ies"} if w.endswith("y") else set())
    if pos == "v":
        stem = w[:-1] if w.endswith("e") else w
        out |= {w + "ed", w + "d", stem + "ing", w + "ing"} | ({w[:-1] + "ied"} if w.endswith("y") else set())
    return out


def wn_example(w, s):
    pat = re.compile(rf"\b({'|'.join(map(re.escape, forms(w)))})\b", re.I)
    return next((e for e in s.examples() if pat.search(e) and 20 <= len(e) <= 160), None)


def usable(s):
    return not re.match(r"\(?(comparative|superlative|plural|past)", s.definition())


def tatoeba_examples(words, path):
    """Best short natural sentence per word (dict word → pos): ~60 chars, few character names."""
    form_to_word = {f: w for w, pos in words.items() for f in forms(w, pos)}
    best = {}
    tok = re.compile(r"[a-z]+")
    with open(path, encoding="utf-8") as f:
        for line in f:
            text = line.rstrip("\n").split("\t")[-1]
            if not 30 <= len(text) <= 110 or not text[-1] in ".!?":
                continue
            score = abs(len(text) - 60) + (25 if re.search(r"\b(Tom|Mary|John)\b", text) else 0)
            for t in set(tok.findall(text.lower())):
                w = form_to_word.get(t)
                if w and (w not in best or score < best[w][0]):
                    best[w] = (score, text)
    return {w: s for w, (_, s) in best.items()}


ARPA = dict(AA="ɑ", AE="æ", AO="ɔ", AW="aʊ", AY="aɪ", EH="ɛ", EY="eɪ", IH="ɪ", IY="i", OW="oʊ", OY="ɔɪ", UH="ʊ", UW="u",
            B="b", CH="tʃ", D="d", DH="ð", F="f", G="ɡ", HH="h", JH="dʒ", K="k", L="l", M="m", N="n", NG="ŋ", P="p",
            R="r", S="s", SH="ʃ", T="t", TH="θ", V="v", W="w", Y="j", Z="z", ZH="ʒ")
ONSETS = set("pl pr bl br kl kr ɡl ɡr fl fr θr dr tr ʃr sp st sk sm sn sl sw sf tw dw kw ɡw θw spl spr str skr skw skl".split())
ONSETS |= {c + "j" for c in "p b f v k ɡ m n h l t d s θ".split()}
CONS = set("p b t d k ɡ f v θ ð s z ʃ ʒ h m n ŋ l r w j tʃ dʒ x".split())


def legal(cl):
    return len(cl) == 1 and cl[0] != "ŋ" or "".join(cl) in ONSETS


def place_stress(phones):
    """phones: [(ipa, stress)] with stress None for consonants. Marks go before the syllable onset."""
    out = []
    for p, st in phones:
        if st in ("ˈ", "ˌ"):
            k = len(out)
            while k > 0 and out[k - 1] in CONS:
                k -= 1
            cl = out[k:]
            n = next((i for i in range(len(cl)) if legal(cl[i:])), len(cl))
            out.insert(k + n, st)
        out.append(p)
    return "".join(out)


def us_ipa(arpa):
    phones = []
    for ph in arpa:
        base, st = ph.rstrip("012"), ph[-1] if ph[-1].isdigit() else None
        if base == "AH":
            ipa = "ə" if st == "0" else "ʌ"
        elif base == "ER":
            ipa = "ɚ" if st == "0" else "ɝ"
        else:
            ipa = ARPA[base]
        phones.append((ipa, {"1": "ˈ", "2": "ˌ"}.get(st)))
    # Single-syllable words carry no stress mark in dictionaries.
    if sum(1 for p in arpa if p[-1].isdigit()) == 1:
        phones = [(p, None) for p, _ in phones]
    return place_stress(phones)


def uk_ipa(raw):
    """ipa-dict en_UK (eSpeak-derived) puts stress right before the vowel; move it to the onset."""
    s = raw.split(",")[0].strip().strip("/").replace("ɹ", "r").replace("ɐ", "ə").replace("ɚ", "ə").replace("g", "ɡ")
    toks, i = [], 0
    while i < len(s):
        two = s[i:i + 2]
        if two in ("tʃ", "dʒ"):
            toks.append(two); i += 2
        else:
            toks.append(s[i]); i += 1
    phones, pend = [], None
    for t in toks:
        if t in "ˈˌ":
            pend = t
        else:
            phones.append((t, pend)); pend = None
    if len(re.findall(r"[aeiouæɑɒɔəɛɜɪʊʌ]+", s)) == 1:
        phones = [(p, None) for p, _ in phones]
    return place_stress(phones)


def load_ipa(path):
    uk = {}
    if path:
        with open(path, encoding="utf-8") as f:
            for line in f:
                w, _, ipa = line.rstrip("\n").partition("\t")
                if w.isalpha() and ipa and not re.search("[ɬʲ\u0303x]", ipa):
                    uk[w] = uk_ipa(ipa)
    us = {w: us_ipa(p[0]) for w, p in cmudict.dict().items()}
    return uk, us


def main():
    rows, rank = [], 0
    for w in top_n_list("en", 120000):
        if not w.isalpha() or not w.isascii() or len(w) < 3 or not is_base(w):
            continue
        z = zipf_frequency(w, "en")
        if z < MIN_ZIPF:
            break
        syns = senses(w)
        if not syns:
            continue
        rank += 1  # rank among real base words, the unit for vocabulary-size estimates
        if w in BLOCK or any(r[0] == w for r in rows[-50:]):
            continue
        syns = [s for s in syns if usable(s)]
        if syns:
            rows.append([w, syns, wn_example(w, syns[0]), z, rank])

    path = os.environ.get("TATOEBA")
    tat = tatoeba_examples({r[0]: r[1][0].pos() for r in rows if not r[2]}, path) if path else {}

    uk, us = load_ipa(os.environ.get("IPA_UK"))
    out = []
    for w, syns, ex, z, r in rows:
        # Prefer the most common sense; fall back to a rarer sense only if it alone has an example.
        s = syns[0]
        ex = ex or tat.get(w)
        if not ex:
            s, ex = next(((t, e) for t in syns[1:4] if (e := wn_example(w, t))), (None, None))
        if not ex:
            continue
        syns = [l.name().replace("_", " ") for l in s.lemmas() if l.name().lower() != w][:3]
        out.append([w, POS[s.pos()], round(z * 10), r, s.definition(), ex, syns, uk.get(w, ""), us.get(w, "")])

    dest = os.path.join(os.path.dirname(__file__), "words.js")
    with open(dest, "w") as f:
        f.write("// Generated by build_words.py from WordNet 3.0, wordfreq and Tatoeba. Fields: word, pos, zipf*10, rank, definition, example, synonyms, UK IPA, US IPA.\n")
        f.write("window.WORDS=")
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        f.write(";\n")
    print(f"{len(out)} words of {rank} ranked base words, {sum(1 for x in rows if x[2])} WordNet examples, "
          f"{len(tat)} Tatoeba, {sum(1 for x in out if x[7])} UK / {sum(1 for x in out if x[8])} US IPA, {os.path.getsize(dest) / 1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
