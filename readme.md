<div align='center'>

# Cobee Playground

<img src="https://wonderful-kitsune-214e14.netlify.app/cobee-terbank.png" width="180" alt="icon" />

A simple VS Code extension to run and preview your JavaScript & HTML code. Built for students who are just getting started with coding 😁😁

<img src="https://wonderful-kitsune-214e14.netlify.app/preview.png" width="700" alt="preview" />
</div>


<p align="center">
    <a href="mailto:wikanadnyana44@gmail.com">Report a Bug</a>
    ·
    <a href="mailto:wikanadnyana44@gmail.com">Request a Feature</a>

<p align="center">Notes : The HTML page live preview is still in alpha version, so it might be unstable😥</p>

</p>

---

## What is Cobee Playground?

Cobee Playground lets you write JavaScript or HTML in VS Code and instantly see the result — no browser tab, no terminal commands, no setup. Just write your code, press **Run**, and see what happens.

It was made for students, so everything is designed to be as clear and beginner-friendly as possible.

## Features

📺 **Live Preview** — See your HTML & JS output right inside VS Code, side by side with your code.

🖥️ **Built-in Console** — `console.log()`, warnings, and errors show up in a clean console panel below the preview. No need to open DevTools.

💡 **Student-Friendly Errors** — When your code has a bug, the extension explains what went wrong in plain language and gives you a checklist of things to fix. Supports both **English** and **Indonesian** 🇮🇩.

🔁 **Infinite Loop Protection** — Accidentally wrote `while(true)`? The extension will warn you before running it, and will automatically stop the code if it gets stuck.

📐 **Resizable Console** — Drag the divider to adjust the console size, or click the header to collapse it completely.

🔔 **Dialog Support** — `alert()`, `prompt()`, and `confirm()` work just like in a browser.

## How to Use

1. Open any `.js` or `.html` file in VS Code
2. Hover over the **editor title bar** (the tab at the top where your filename is shown)
3. You'll see a **▶ Cobee Playground: Run** button appear — click it!
4. The preview panel will open on the right side, and your code will run instantly 🎉

> **Note:** The run button only appears when you're inside a `.js` or `.html` file.

## Error Example

When your code has an error like:

```js
console.log(myName)
```

Instead of the confusing default message, Cobee will tell you:

> **myName** is missing or undefined
> - → Check your spelling (uppercase/lowercase matters)
> - → Define it using `let`, `const`, or `var`
> - → Make sure it's declared before this line

And you can click the **ID** button to read it in Indonesian.

## Requirements

- VS Code **1.60.0** or higher
- Your desire to learn 😬

## License

[MIT
