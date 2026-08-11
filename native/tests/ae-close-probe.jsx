/*
 * Closes whatever project is open without saving, so the next suite starts
 * clean. The scripted suites leave a modified untitled project behind, and
 * launching another script against one makes After Effects ask whether to save
 * it — a modal that automation cannot answer.
 */
app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
var out = new File("G:/AICODE/island-chatter-ae/ae-close-project.txt");
out.open("w");
out.write("closed\n");
out.close();
