"""HBP specialty synonym mapping.

Maps everyday clinical language ("heart surgery", "cancer", "delivery") to the
HBP specialty codes used in the TMS `speciality_code` column. The canonical
code->name table is grounded in the actual values present in the data; the
HBP-2022.pdf package master (in the reference folder) is the upstream source of
truth for the full procedure list and can be parsed later to enrich this map.
"""
from __future__ import annotations

from dataclasses import dataclass

# Canonical specialty code -> display name (PM-JAY HBP specialties).
SPECIALTY_NAMES: dict[str, str] = {
    "BM": "Burns Management",
    "ER": "Emergency Room Packages",
    "MC": "Cardiology",
    "MG": "General Medicine",
    "MM": "Mental Disorders",
    "MN": "Neo-natal Care",
    "MO": "Medical Oncology",
    "MR": "Radiation Oncology",
    "SB": "Orthopedics",
    "SC": "Surgical Oncology",
    "SE": "Ophthalmology",
    "SG": "General Surgery",
    "SL": "ENT",
    "SM": "Oral & Maxillofacial Surgery",
    "SN": "Neurosurgery",
    "SO": "Obstetrics & Gynecology",
    "SP": "Plastic & Reconstructive Surgery",
    "SS": "Pediatric Surgery",
    "ST": "Polytrauma",
    "SU": "Urology",
    "SV": "Cardio-thoracic & Vascular Surgery (CTVS)",
    # Additional HBP specialties that may appear in the full dataset:
    "MD": "Dermatology",
    "SD": "Dental",
    "PMR": "Physical Medicine & Rehabilitation",
    "IHBP": "Interventional Neuroradiology",
}

# Free-text phrase -> list of specialty codes it should map to.
_SYNONYMS: dict[str, list[str]] = {
    "cardiac": ["MC", "SV"],
    "heart": ["MC", "SV"],
    "heart surgery": ["SV"],
    "cardiology": ["MC"],
    "bypass": ["SV"],
    "cancer": ["MO", "MR", "SC"],
    "oncology": ["MO", "MR", "SC"],
    "chemotherapy": ["MO"],
    "chemo": ["MO"],
    "radiation": ["MR"],
    "radiotherapy": ["MR"],
    "tumour": ["MO", "MR", "SC"],
    "tumor": ["MO", "MR", "SC"],
    "delivery": ["SO"],
    "childbirth": ["SO"],
    "maternal": ["SO"],
    "maternity": ["SO"],
    "pregnancy": ["SO"],
    "obstetric": ["SO"],
    "gynaecology": ["SO"],
    "gynecology": ["SO"],
    "eye": ["SE"],
    "cataract": ["SE"],
    "ophthalmology": ["SE"],
    "vision": ["SE"],
    "bone": ["SB"],
    "fracture": ["SB"],
    "orthopedic": ["SB"],
    "orthopaedic": ["SB"],
    "joint replacement": ["SB"],
    "knee": ["SB"],
    "hip": ["SB"],
    "ent": ["SL"],
    "ear": ["SL"],
    "nose": ["SL"],
    "throat": ["SL"],
    "brain": ["SN"],
    "neurosurgery": ["SN"],
    "neuro": ["SN"],
    "spine": ["SN", "SB"],
    "kidney": ["SU"],
    "urology": ["SU"],
    "urinary": ["SU"],
    "dialysis": ["MG"],  # haemodialysis coded MG072B in the prototype
    "haemodialysis": ["MG"],
    "hemodialysis": ["MG"],
    "burns": ["BM"],
    "burn": ["BM"],
    "mental": ["MM"],
    "psychiatric": ["MM"],
    "psychiatry": ["MM"],
    "ect": ["MM"],
    "newborn": ["MN"],
    "neonatal": ["MN"],
    "neo-natal": ["MN"],
    "emergency": ["ER"],
    "trauma": ["ST"],
    "polytrauma": ["ST"],
    "accident": ["ST", "ER"],
    "plastic surgery": ["SP"],
    "reconstructive": ["SP"],
    "pediatric surgery": ["SS"],
    "paediatric surgery": ["SS"],
    "dental": ["SM", "SD"],
    "jaw": ["SM"],
    "general surgery": ["SG"],
    "general medicine": ["MG"],
}


@dataclass
class SpecialtyMatch:
    phrase: str
    codes: list[str]
    names: list[str]


class SynonymResolver:
    def match(self, text: str) -> list[SpecialtyMatch]:
        """Return every specialty phrase found in the text (longest first)."""
        t = text.lower()
        found: list[SpecialtyMatch] = []
        seen_codes: set[str] = set()
        for phrase in sorted(_SYNONYMS, key=len, reverse=True):
            if phrase in t:
                codes = [c for c in _SYNONYMS[phrase] if c not in seen_codes]
                if codes:
                    seen_codes.update(codes)
                    found.append(
                        SpecialtyMatch(
                            phrase=phrase,
                            codes=_SYNONYMS[phrase],
                            names=[SPECIALTY_NAMES.get(c, c) for c in _SYNONYMS[phrase]],
                        )
                    )
        return found

    @staticmethod
    def name(code: str) -> str:
        return SPECIALTY_NAMES.get(code, code)


_resolver: SynonymResolver | None = None


def get_synonyms() -> SynonymResolver:
    global _resolver
    if _resolver is None:
        _resolver = SynonymResolver()
    return _resolver
