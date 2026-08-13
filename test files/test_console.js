// ═══════════════════════════════════════════
//  Cobee Playground — Console Output Test
// ═══════════════════════════════════════════

// ── 1. Basic Arrays (should be horizontal) ──
console.log([0, 1, 2]);
console.log(["apple", "banana", "cherry"]);
console.log([true, false, null, undefined]);

// ── 2. Nested Arrays ──
console.log([[1, 2], [3, 4], [5, 6]]);
console.log([["a", "b"], ["c", "d"]]);

// ── 3. Mixed types in array ──
console.log([1, "hello", true, null]);

// ── 4. Empty array ──
console.log([]);

// ── 5. Multiple args (all on one line each) ──
console.log("Numbers:", [10, 20, 30]);
console.log("Label", [1, 2, 3], "end");

// ── 6. Objects (should still be multi-line) ──
console.log({ name: "Alice", age: 25 });

// ── 7. Primitives ──
console.log(42);
console.log("Hello, World!");
console.log(true);
console.log(null);
console.log(undefined);

// ── 8. Warnings & Errors ──
console.warn("This is a warning");
console.error("This is an error");
console.info("This is info");

// ── 9. Array of objects ──
console.log([{ id: 1 }, { id: 2 }]);
