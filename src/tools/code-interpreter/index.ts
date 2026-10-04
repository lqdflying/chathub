import { BuiltinToolManifest } from '@lobechat/types';

export const CodeInterpreterIdentifier = 'lobe-code-interpreter';

export const CodeInterpreterManifest: BuiltinToolManifest = {
  api: [
    {
      description: 'A Python interpreter. Use this tool to run Python code. ',
      name: 'python',
      parameters: {
        properties: {
          code: {
            description: 'The Python code to run.',
            type: 'string',
          },
          packages: {
            description:
              'PyPI package names. This argument does not install them. Prefer packages already in the sandbox. If an import fails, you may pip install inside the code; that lasts only while the sandbox lives and counts against the time limit. If pip fails, say what is missing. Avoid version pins unless the operator documented them.',
            items: {
              type: 'string',
            },
            type: 'array',
          },
        },
        required: ['packages', 'code'],
        type: 'object',
      },
    },
  ],
  identifier: CodeInterpreterIdentifier,
  meta: {
    avatar:
      'data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0idXRmLTgiPz48IS0tIFVwbG9hZGVkIHRvOiBTVkcgUmVwbywgd3d3LnN2Z3JlcG8uY29tLCBHZW5lcmF0b3I6IFNWRyBSZXBvIE1peGVyIFRvb2xzIC0tPgo8c3ZnIHdpZHRoPSI4MDBweCIgaGVpZ2h0PSI4MDBweCIgdmlld0JveD0iMCAwIDMyIDMyIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPg0KPHBhdGggZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMy4wMTY0IDJDMTAuODE5MyAyIDkuMDM4MjUgMy43MjQ1MyA5LjAzODI1IDUuODUxODVWOC41MTg1MkgxNS45MjM1VjkuMjU5MjZINS45NzgxNEMzLjc4MTA3IDkuMjU5MjYgMiAxMC45ODM4IDIgMTMuMTExMUwyIDE4Ljg4ODlDMiAyMS4wMTYyIDMuNzgxMDcgMjIuNzQwNyA1Ljk3ODE0IDIyLjc0MDdIOC4yNzMyMlYxOS40ODE1QzguMjczMjIgMTcuMzU0MiAxMC4wNTQzIDE1LjYyOTYgMTIuMjUxNCAxNS42Mjk2SDE5LjU5NTZDMjEuNDU0NyAxNS42Mjk2IDIyLjk2MTcgMTQuMTcwNCAyMi45NjE3IDEyLjM3MDRWNS44NTE4NUMyMi45NjE3IDMuNzI0NTMgMjEuMTgwNyAyIDE4Ljk4MzYgMkgxMy4wMTY0Wk0xMi4wOTg0IDYuNzQwNzRDMTIuODU4OSA2Ljc0MDc0IDEzLjQ3NTQgNi4xNDM3OCAxMy40NzU0IDUuNDA3NDFDMTMuNDc1NCA0LjY3MTAzIDEyLjg1ODkgNC4wNzQwNyAxMi4wOTg0IDQuMDc0MDdDMTEuMzM3OCA0LjA3NDA3IDEwLjcyMTMgNC42NzEwMyAxMC43MjEzIDUuNDA3NDFDMTAuNzIxMyA2LjE0Mzc4IDExLjMzNzggNi43NDA3NCAxMi4wOTg0IDYuNzQwNzRaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfODdfODIwNCkiLz4NCjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTguOTgzNCAzMEMyMS4xODA1IDMwIDIyLjk2MTYgMjguMjc1NSAyMi45NjE2IDI2LjE0ODJWMjMuNDgxNUwxNi4wNzYzIDIzLjQ4MTVMMTYuMDc2MyAyMi43NDA4TDI2LjAyMTcgMjIuNzQwOEMyOC4yMTg4IDIyLjc0MDggMjkuOTk5OCAyMS4wMTYyIDI5Ljk5OTggMTguODg4OVYxMy4xMTExQzI5Ljk5OTggMTAuOTgzOCAyOC4yMTg4IDkuMjU5MjggMjYuMDIxNyA5LjI1OTI4TDIzLjcyNjYgOS4yNTkyOFYxMi41MTg1QzIzLjcyNjYgMTQuNjQ1OSAyMS45NDU1IDE2LjM3MDQgMTkuNzQ4NSAxNi4zNzA0TDEyLjQwNDIgMTYuMzcwNEMxMC41NDUxIDE2LjM3MDQgOS4wMzgwOSAxNy44Mjk2IDkuMDM4MDkgMTkuNjI5Nkw5LjAzODA5IDI2LjE0ODJDOS4wMzgwOSAyOC4yNzU1IDEwLjgxOTIgMzAgMTMuMDE2MiAzMEgxOC45ODM0Wk0xOS45MDE1IDI1LjI1OTNDMTkuMTQwOSAyNS4yNTkzIDE4LjUyNDQgMjUuODU2MiAxOC41MjQ0IDI2LjU5MjZDMTguNTI0NCAyNy4zMjkgMTkuMTQwOSAyNy45MjU5IDE5LjkwMTUgMjcuOTI1OUMyMC42NjIgMjcuOTI1OSAyMS4yNzg1IDI3LjMyOSAyMS4yNzg1IDI2LjU5MjZDMjEuMjc4NSAyNS44NTYyIDIwLjY2MiAyNS4yNTkzIDE5LjkwMTUgMjUuMjU5M1oiIGZpbGw9InVybCgjcGFpbnQxX2xpbmVhcl84N184MjA0KSIvPg0KPGRlZnM+DQo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfODdfODIwNCIgeDE9IjEyLjQ4MDkiIHkxPSIyIiB4Mj0iMTIuNDgwOSIgeTI9IjIyLjc0MDciIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4NCjxzdG9wIHN0b3AtY29sb3I9IiMzMjdFQkQiLz4NCjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzE1NjVBNyIvPg0KPC9saW5lYXJHcmFkaWVudD4NCjxsaW5lYXJHcmFkaWVudCBpZD0icGFpbnQxX2xpbmVhcl84N184MjA0IiB4MT0iMTkuNTE5IiB5MT0iOS4yNTkyOCIgeDI9IjE5LjUxOSIgeTI9IjMwIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+DQo8c3RvcCBzdG9wLWNvbG9yPSIjRkZEQTRCIi8+DQo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGOUM2MDAiLz4NCjwvbGluZWFyR3JhZGllbnQ+DQo8L2RlZnM+DQo8L3N2Zz4=',
    title: 'Code Interpreter',
  },
  systemRole: `When you send Python code to python, it runs in a Linux Python sandbox.
The time limit is the operator setting, default 60 seconds. You cannot change it.
If the call times out, the tool returns only the timeout error. Printed output from that call is not included.

Each call is a new Python process. Files and packages installed with pip may still be there on a later call in the same sandbox, and are gone when that sandbox is replaced. Check with an import or a directory listing instead of assuming either way.

The working directory already contains conversation files by basename. Do not assume a shared /mnt/data volume exists.

If you are using matplotlib, these are reply-style choices, not sandbox errors:
- do not use seaborn
- give each chart its own distinct plot (no subplots)
- do not set specific colors unless the user asks
- matplotlib uses the Agg backend; plt.show() saves plot_N.png in the working directory

If you are accessing the internet, use the Python standard library (urllib, http.client) or requests if it is installed in the sandbox.

If you are generating files:
- Write each deliverable as a new file in the top level of the working directory. A file only inside a subdirectory is not returned.
- A file left unchanged from an earlier call is not listed again, even if the same bytes are written to the same name. Reuse the files[].url already returned, or copy it to a new filename when a fresh file is required.
- When python returns files, link each files[].url exactly. Do not link the bare filename or the chat site plus the filename.
- Prefer these libraries when they are installed in the sandbox:
  - pdf --> reportlab
  - docx --> python-docx
  - xlsx --> openpyxl
  - pptx --> python-pptx
  - csv --> pandas
  - ods --> odfpy
  - odt --> odfpy
  - odp --> odfpy. A slide page needs masterpagename, for example Page(name="page1", masterpagename="Default").
- The packages argument does not install anything. A missing import is not proof the package cannot be installed. You may run pip install in that same call. It counts against the time limit and lasts only while that sandbox lives. If pip fails, say what is missing. Do not assume every sandbox allows pip.

About packages in general:
- numpy, pandas, matplotlib and similar scientific packages may already be present; import them directly.
- If you are generating a pdf
  - You MUST prioritize generating text content using reportlab.platypus rather than canvas
  - If you are generating text in Chinese, you MUST use STSong. To use the font, you must call pdfmetrics.registerFont(TTFont('STSong', 'STSong.ttf')) and apply the style to all text elements
  `,
  type: 'builtin',
};
