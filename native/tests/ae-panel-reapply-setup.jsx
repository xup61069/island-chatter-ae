#target aftereffects

(function () {
    if (app.project && (app.project.file || app.project.numItems > 0)) {
        alert("Close the current project before running the Island Chatter panel reapply test.");
        return;
    }
    if (!app.project) { app.newProject(); }

    var comp = app.project.items.addComp(
        "Island Chatter Panel Reapply Test", 1280, 720, 1, 8, 30);
    var layer = comp.layers.addText("你好，今天一起去散步。");
    layer.name = "Island Chatter Panel Reapply Test";
    comp.openInViewer();
    layer.selected = true;
}());
