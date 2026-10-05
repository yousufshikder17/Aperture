import assert from "node:assert/strict";
import test from "node:test";
import { careerText } from "../src/services/career-text.js";

test("single HTML parse preserves literal encoded examples and semantic boundaries", () => {
  assert.equal(careerText("<p>Use List&lt;T&gt; and Map&lt;K,V&gt;.</p><p>Example: &lt;script&gt; is an element.</p>"),
    "Use List<T> and Map<K,V>.\nExample: <script> is an element.");
  assert.equal(careerText('<p>Build &amp; test</p><ul><li>Ship <a href="javascript:bad()">safely</a></li></ul>'),
    "Build & test\nShip safely");
});

test("executable markup is removed without reparsing already-decoded text", () => {
  assert.equal(careerText('<p>Safe</p><script>bad()</script><style>bad</style><template>bad</template><noscript>bad</noscript>'), "Safe");
  assert.equal(careerText("<pre>&lt;img src=x onerror=bad()&gt;</pre>"), "<img src=x onerror=bad()>");
});
