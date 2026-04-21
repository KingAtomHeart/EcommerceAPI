const toObj = (val) =>
    val instanceof Map ? Object.fromEntries(val) : (val || {});

// Returns images sorted most-specific first. Specificity = number of keys in appliesTo.
function resolveImages(product, selectedAttrs) {
    const attrs = toObj(selectedAttrs);
    const candidates = (product.variantImages || []).filter(img => {
        const at = toObj(img.appliesTo);
        return Object.entries(at).every(([k, v]) => attrs[k] === v);
    });
    return candidates.sort((a, b) => {
        const aSize = Object.keys(toObj(a.appliesTo)).length;
        const bSize = Object.keys(toObj(b.appliesTo)).length;
        return bSize - aSize;
    });
}

// Finds the exact variant matching all dimension values in selectedAttrs.
function findVariant(product, selectedAttrs) {
    const dims = (product.variantDimensions || []).map(d => d.name);
    const sel = toObj(selectedAttrs);
    return (product.variants || []).find(v => {
        const attrs = toObj(v.attributes);
        return dims.every(d => attrs[d] === sel[d]);
    });
}

// Returns the set of values for dimensionName that have at least one
// in-stock, available variant compatible with the current partial selection.
function allowedValuesFor(product, dimensionName, selectedAttrs) {
    const sel = toObj(selectedAttrs);
    const allowed = new Set();
    for (const v of (product.variants || [])) {
        if (v.available === false) continue;
        if (v.stock === 0) continue;
        const attrs = toObj(v.attributes);
        const compatible = Object.entries(sel).every(([k, val]) =>
            k === dimensionName || !val || attrs[k] === val
        );
        if (compatible && attrs[dimensionName]) allowed.add(attrs[dimensionName]);
    }
    return allowed;
}

module.exports = { resolveImages, findVariant, allowedValuesFor, toObj };
